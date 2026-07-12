#!/usr/bin/env python3
"""Audit deterministico del catalogo UniMi prima di generare/applicare il seed."""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import scraper


ROOT = Path(__file__).resolve().parent
EXPECTED_EMPTY = {
    'artificial-intelligence',
    'infermieristica',
    'interpretariato-traduzione-lis-list',
    'ostetricia',
    'tecnologie-gestione-impresa-casearia',
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-sources', action='store_true')
    args = parser.parse_args()

    programs = json.loads((ROOT / 'programs.json').read_text(encoding='utf-8'))
    data = json.loads((ROOT / 'catalog.json').read_text(encoding='utf-8'))
    catalog = data['catalog']
    teachers = data['teachers']
    metadata = data.get('metadata', {})
    errors = []
    warnings = []

    program_slugs = {p['slug'] for p in programs}
    if len(programs) != 81:
        errors.append(f'programmi attesi 81, trovati {len(programs)}')
    types = Counter(p['degree_type'] for p in programs)
    if types != Counter({'triennale': 72, 'ciclo-unico': 9}):
        errors.append(f'tipi corso inattesi: {dict(types)}')
    if set(catalog) != program_slugs:
        errors.append('chiavi catalogo e registro programmi non coincidono')

    empty = {slug for slug, rows in catalog.items() if not rows}
    if empty != EXPECTED_EMPTY:
        errors.append(f'programmi senza piano inattesi: {sorted(empty)}')

    pair_names = defaultdict(set)
    for slug, rows in catalog.items():
        for row in rows:
            pair_names[(slug, row['href'])].add(row['name'])
            if not row['href'].startswith('/it/corsi/insegnamenti-dei-corsi-di-laurea/'):
                errors.append(f'href non UniMi: {slug}|{row["href"]}')
    expected_teacher_keys = {f'{slug}|{href}' for slug, href in pair_names}
    if set(teachers) != expected_teacher_keys:
        errors.append('chiavi docenti e coppie corso-insegnamento non coincidono')

    allowed_years = {
        metadata.get('plan_academic_year'),
        *metadata.get('fallback_academic_years', []),
    }
    allowed_years.discard(None)
    aa_counts = Counter()
    method_counts = Counter()
    professor_names = defaultdict(set)
    source_failures = []
    for key, result in teachers.items():
        if result.get('match_method') == 'error' or result.get('error'):
            errors.append(f'errore scrape docenti: {key}: {result.get("error")}')
        editions = result.get('history', [])
        if not editions:
            method_counts['unavailable'] += 1
        for edition in editions:
            method = edition.get('match_method')
            method_counts[method] += 1
            source = edition.get('source', '')
            if not source.startswith('/it/corsi/insegnamenti-dei-corsi-di-laurea/'):
                errors.append(f'sorgente docente non UniMi: {key}: {source}')
            aa = edition.get('aa')
            aa_counts[aa] += 1
            if aa not in allowed_years:
                errors.append(f'A.A. docente fuori finestra: {key}: {aa}')
            for professor in edition['teachers']:
                professor_names[professor['slug']].add(professor['name'])

            if args.verify_sources and method != 'current':
                slug, href = key.split('|', 1)
                program = next(p for p in programs if p['slug'] == slug)
                names = pair_names[(slug, href)]
                source_html = scraper.fetch(source)
                valid_course = scraper.page_course_key(source_html) in {
                    scraper.course_match_key(name) for name in names
                }
                valid_degree = scraper.page_matches_degree(
                    source_html,
                    scraper.degree_match_targets(program['name'], program.get('cds_match')),
                )
                if not valid_course or not valid_degree:
                    source_failures.append({
                        'key': key,
                        'academic_year': aa,
                        'source': source,
                        'valid_course': valid_course,
                        'valid_degree': valid_degree,
                    })

    conflicts = {slug: sorted(names) for slug, names in professor_names.items() if len(names) > 1}
    if conflicts:
        errors.append(f'{len(conflicts)} slug professore associati a nomi diversi')
    if source_failures:
        errors.append(f'{len(source_failures)} fallback non superano la verifica corso+CdS')

    missing_teachers = [key for key, value in teachers.items() if not value.get('teachers')]
    coverage = round(100 * (len(teachers) - len(missing_teachers)) / max(len(teachers), 1), 2)
    report = {
        'ok': not errors,
        'errors': errors,
        'warnings': warnings,
        'generated_at': metadata.get('generated_at'),
        'source_domain': metadata.get('source_domain'),
        'programs': len(programs),
        'degree_types': dict(types),
        'ready_programs': len(programs) - len(empty),
        'empty_programs': sorted(empty),
        'course_rows': sum(len(rows) for rows in catalog.values()),
        'unique_course_pairs': len(teachers),
        'pairs_with_teachers': len(teachers) - len(missing_teachers),
        'teacher_coverage_percent': coverage,
        'historical_course_editions': sum(aa_counts.values()),
        'teacher_academic_years': dict(sorted(aa_counts.items(), reverse=True)),
        'match_methods': dict(method_counts),
        'unique_professors': len(professor_names),
        'professor_slug_conflicts': conflicts,
        'verified_fallback_sources': args.verify_sources,
        'source_failures': source_failures[:50],
    }
    (ROOT / 'audit-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
