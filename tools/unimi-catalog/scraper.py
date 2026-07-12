#!/usr/bin/env python3
"""Scraper piani di studio UniMi (triennali + magistrali a ciclo unico): per
ogni CdL estrae insegnamenti (anno, CFU, ore, lingua, SSD, curriculum,
periodo, gruppo/regola di scelta) dalla pagina del corso e i docenti dalla
pagina di ogni insegnamento e dai piani storici ufficiali collegati dal CdS.

Le pagine unimi.it usano due layout tabellari: quello storico a 5 colonne
(periodo nei divider "titoletto") e quello nuovo a 6 colonne (periodo come
colonna). Le celle vengono lette tramite l'attributo data-title, con fallback
posizionale, così entrambi i layout producono le stesse righe. Le attività a
scelta stanno fuori dalla tabella principale, dentro i blocchi
ugov-of-pd-rules: anche quelle vengono estratte, con l'etichetta della regola
come grouping.
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape

BASE = 'https://www.unimi.it'
SCRATCH = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SCRATCH, 'cache')
os.makedirs(CACHE, exist_ok=True)
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 UnimiDocCatalog/1.0'}
REFRESH_CACHE = os.environ.get('UNIMI_CATALOG_REFRESH') == '1'
NEGATIVE_CACHE_TTL_SECONDS = int(os.environ.get('UNIMI_CATALOG_NEGATIVE_CACHE_TTL', '21600'))
PLAN_ACADEMIC_YEAR = '2026/2027'
FALLBACK_ACADEMIC_YEARS = ('2025/2026', '2024/2025', '2023/2024')
PIPELINE_VERSION = 'unimi-catalog-v3-history-official-plans'


def atomic_json_dump(path: str, value) -> None:
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False)
    os.replace(tmp, path)


def fetch(path: str) -> str:
    key = re.sub(r'[^a-z0-9]+', '_', path.lower()).strip('_')[:180]
    cpath = os.path.join(CACHE, key + '.html')
    if os.path.exists(cpath):
        cached = open(cpath, encoding='utf-8', errors='replace').read()
        negative_expired = cached == '__404__' and time.time() - os.path.getmtime(cpath) > NEGATIVE_CACHE_TTL_SECONDS
        if not REFRESH_CACHE and not negative_expired:
            return cached
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                html = res.read().decode('utf-8', errors='replace')
            tmp = f'{cpath}.{os.getpid()}.tmp'
            open(tmp, 'w', encoding='utf-8').write(html)
            os.replace(tmp, cpath)
            return html
        except urllib.error.HTTPError as e:
            if e.code == 404:
                tmp = f'{cpath}.{os.getpid()}.tmp'
                open(tmp, 'w', encoding='utf-8').write('__404__')
                os.replace(tmp, cpath)
                return '__404__'
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    tmp = f'{cpath}.{os.getpid()}.tmp'
    open(tmp, 'w', encoding='utf-8').write('__404__')
    os.replace(tmp, cpath)
    return '__404__'


def text_of(fragment: str) -> str:
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


PERIOD_HINT = re.compile(r'semestre|trimestre|quadrimestre|annuale|periodo', re.I)
HREF_RE = re.compile(r'href="(/it/corsi/insegnamenti-dei-corsi-di-laurea/\d+/[^"]+)"')
CELL_RE = re.compile(r'<td([^>]*)>(.*?)</td>', re.S)
DATA_TITLE_RE = re.compile(r'data-title="([^"]*)"')

# Token di livello tab, in ordine di documento:
#  - titoletto  : divider di sezione (periodo oppure vincolo es. "Obbligatorio")
#  - rowsubtitle: sottotitolo dentro la tabella (vincolo)
#  - rules      : etichetta di una regola di scelta ("01 - UN ESAME A SCELTA TRA")
#  - row        : riga insegnamento
TOKEN_RE = re.compile(
    r'(?:<div class="top30 titoletto">(?P<titoletto>.*?)</div>)'
    r'|(?:<tr class="rowsubtitle[^"]*">\s*<td[^>]*>(?P<subtitle>.*?)</td>)'
    r'|(?:<div class="ugov-of-pd-year-rules-\d+">\s*<div>(?P<rule>.*?)</div>)'
    r'|(?:<tr>\s*(?P<row><td[^>]*data-title="Attivit[^"]*"[^>]*>.*?)</tr>)'
    r'|(?:<tr>\s*(?P<rowlegacy><td class="cdl-title"[^>]*>.*?)</tr>)',
    re.S)

CELL_MAP = {
    'crediti massimi': 'cfu', 'crediti': 'cfu', 'cfu': 'cfu',
    'ore totali': 'hours', 'ore': 'hours',
    'lingua': 'lang',
    'periodo': 'period',
    'ssd': 'ssd', 'settore': 'ssd',
}


def parse_row(cells_html: str):
    """Riga insegnamento → dict campi. Celle lette per data-title, fallback
    posizionale (cfu, ore, lingua[, periodo], ssd) dopo la cella del nome."""
    cells = CELL_RE.findall(cells_html + '</td>' if not cells_html.rstrip().endswith('</td>') else cells_html)
    if not cells:
        return None
    name, href = None, None
    fields = {'cfu': '', 'hours': '', 'lang': '', 'period': '', 'ssd': ''}
    positional = []
    for attrs, body in cells:
        hm = HREF_RE.search(body)
        if hm and href is None:
            href = hm.group(1)
            name = text_of(body)
            continue
        dt = DATA_TITLE_RE.search(attrs)
        key = CELL_MAP.get(text_of(dt.group(1)).lower()) if dt else None
        if key:
            fields[key] = text_of(body)
        else:
            positional.append(text_of(body))
    if not href:
        return None
    if positional and not any(fields.values()):
        order = ['cfu', 'hours', 'lang', 'period', 'ssd'] if len(positional) >= 5 else ['cfu', 'hours', 'lang', 'ssd']
        for key, value in zip(order, positional):
            fields[key] = value
    return {'href': href, 'name': name, **fields}


def parse_degree_page(html: str):
    """Estrae i piani didattici: lista di insegnamenti con curriculum/anno/periodo."""
    out = []
    panel_re = re.compile(r'<a[^>]*class="panel-title"[^>]*href="#(curr-[^"]+)"[^>]*>(.*?)</a>', re.S)
    panels = [(m.group(1), text_of(m.group(2))) for m in panel_re.finditer(html)]
    for panel_id, panel_title in panels:
        body_start = html.find(f'id="{panel_id}"')
        if body_start < 0:
            continue
        next_panel = html.find('panel-heading', body_start + 10)
        body = html[body_start:next_panel if next_panel > 0 else len(html)]
        curriculum = re.sub(r'^Piano didattico\s*', '', panel_title).strip(' -–')
        year_ids = re.findall(r'href="#(ugov-of-pd-year[^"]+)"[^>]*>\s*<div>\s*(?:Anno:\s*(\d+)|([^<]+?))\s*</div>', body)
        for tab_id, year_num, alt_label in year_ids:
            tab_start = body.find(f'id="{tab_id}"')
            if tab_start < 0:
                continue
            tab_end = body.find('id="ugov-of-pd-year', tab_start + 10)
            tab = body[tab_start:tab_end if tab_end > 0 else len(body)]
            year = int(year_num) if year_num else 0  # 0 = non annuale (es. "Attività conclusive")
            year_label = alt_label.strip() if alt_label else f'Anno {year_num}'
            period = ''
            grouping = ''
            for m in TOKEN_RE.finditer(tab):
                if m.group('titoletto') is not None:
                    label = text_of(m.group('titoletto'))
                    if PERIOD_HINT.search(label):
                        period = label
                    else:
                        grouping = label
                elif m.group('subtitle') is not None:
                    grouping = text_of(m.group('subtitle'))
                elif m.group('rule') is not None:
                    grouping = text_of(m.group('rule'))
                else:
                    row = parse_row(m.group('row') or m.group('rowlegacy'))
                    if not row:
                        continue
                    out.append({
                        'curriculum': curriculum,
                        'year': year,
                        'year_label': year_label,
                        'period': row['period'] or period,
                        'grouping': grouping,
                        'href': row['href'],
                        'name': row['name'],
                        'cfu': row['cfu'],
                        'hours': row['hours'],
                        'lang': row['lang'],
                        'ssd': row['ssd'],
                    })
    return out


PERSON_RE = re.compile(r'href="/it/ugov/person/([a-z0-9-]+)"[^>]*>([^<]+)</a>')


def parse_teachers(html: str):
    """Estrae docenti (slug, nome) e responsabile dalla pagina insegnamento."""
    if html == '__404__':
        return None
    aa = re.search(r'A\.A\. (\d{4}/\d{4})', html)
    body_start = html.find('type-afed')
    scope = html[body_start:] if body_start > 0 else html
    people = []
    seen = set()
    resp_slug = None
    resp_zone = scope[:4000]
    rm = PERSON_RE.search(resp_zone)
    if rm and 'Responsabile' in text_of(resp_zone[:rm.start()])[-200:]:
        resp_slug = rm.group(1)
    for m in PERSON_RE.finditer(scope):
        slug, name = m.group(1), text_of(m.group(2))
        if slug in seen:
            continue
        seen.add(slug)
        people.append({'slug': slug, 'name': name, 'role': 'responsabile' if slug == resp_slug else 'docente'})
    return {'aa': aa.group(1) if aa else None, 'teachers': people}


ALT_OFFER_RE = re.compile(
    r'<a[^>]+href="(/it/corsi/altre_offerte/[^"]+)"[^>]*>(.*?)</a>',
    re.S | re.I,
)
HISTORICAL_PLAN_RE = re.compile(r'^/it/corsi/altre_offerte/aa-(\d{4})/(\d{4})/')
COURSE_TITLE_RE = re.compile(
    r'<div[^>]*class="[^"]*field--name-title[^"]*"[^>]*>(.*?)</div>',
    re.S | re.I,
)


def norm(s: str) -> str:
    s = unescape(s).lower()
    s = re.sub(r'[àáâ]', 'a', s)
    s = re.sub(r'[èéê]', 'e', s)
    s = re.sub(r'[ìíî]', 'i', s)
    s = re.sub(r'[òóô]', 'o', s)
    s = re.sub(r'[ùúû]', 'u', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def course_match_key(name: str) -> str:
    """Titolo stabile tra edizioni. UniMi usa talvolta il suffisso editoriale
    ``(of2)`` nel piano storico, senza che cambi l'insegnamento."""
    return norm(re.sub(r'\s*\(of\d+\)\s*$', '', name, flags=re.I))


def page_course_key(html: str) -> str:
    match = COURSE_TITLE_RE.search(html)
    return course_match_key(text_of(match.group(1))) if match else ''


def degree_name_from_offer_label(label: str) -> str:
    clean = text_of(label)
    clean = re.split(r'\s*\(class[ei]\b', clean, maxsplit=1, flags=re.I)[0]
    clean = re.split(r'\s*-\s*(?:immatricolati|enrolled)\b', clean, maxsplit=1, flags=re.I)[0]
    return norm(clean)


def degree_match_targets(degree_name: str, cds_match: str | None) -> list[str]:
    """Nomi CdS accettabili, normalizzati. Il nome piattaforma può avere
    acronimi tra parentesi ("(SIE)") o suffissi assenti sulle pagine
    insegnamento: si prova il nome pieno e la variante senza parentetica."""
    # ``cds_match`` e un override intenzionalmente stretto per corsi che
    # condividono quasi lo stesso nome (in particolare i poli di Medicina).
    # Non aggiungere in quel caso la variante generica del nome: riaprirebbe
    # la contaminazione tra poli che questo campo serve a prevenire.
    if cds_match:
        return [norm(cds_match)]
    targets = []
    targets.append(norm(degree_name))
    without_paren = re.sub(r'\s*[\(–-].*?$', '', degree_name).strip()
    stripped = norm(re.sub(r'\([^)]*\)', '', degree_name))
    for cand in (stripped, norm(without_paren)):
        if cand and cand not in targets:
            targets.append(cand)
    return list(dict.fromkeys(t for t in targets if t))


def page_matches_degree(html: str, targets: list[str]) -> bool:
    for _, label in ALT_OFFER_RE.findall(html):
        page_cds = degree_name_from_offer_label(label)
        for t in targets:
            if page_cds == t:
                return True
            # L'unica estensione editoriale ammessa e l'abbreviazione
            # "c.u.". Un prefisso generico farebbe invece combaciare corsi
            # distinti come "Chimica" e "Chimica industriale".
            if page_cds == f'{t} c u':
                return True
    return False


def historical_plan_links(degree_html: str) -> list[tuple[str, str]]:
    links = []
    seen = set()
    for href, _ in ALT_OFFER_RE.findall(degree_html):
        match = HISTORICAL_PLAN_RE.match(href)
        if not match:
            continue
        aa = f'{match.group(1)}/{match.group(2)}'
        if aa not in FALLBACK_ACADEMIC_YEARS or href in seen:
            continue
        seen.add(href)
        links.append((aa, href))
    return links


def build_historical_course_index(programs: list[dict], degree_html: dict[str, str]):
    """Indicizza gli href storici partendo dai piani ufficiali linkati nella
    pagina di ciascun CdS. Evita di indovinare il docente da uno slug simile e
    mantiene separati poli/curricula che condividono titoli di insegnamento."""
    owners = defaultdict(list)
    for program in programs:
        slug = program['slug']
        for aa, plan_href in historical_plan_links(degree_html.get(slug, '')):
            owners[plan_href].append((slug, aa))

    parsed_plans = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(fetch, href): href for href in owners}
        for future in as_completed(futures):
            href = futures[future]
            html = future.result()
            parsed_plans[href] = parse_degree_page(html) if html != '__404__' else []

    index = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for plan_href, refs in owners.items():
        rows = parsed_plans.get(plan_href, [])
        for slug, aa in refs:
            for row in rows:
                key = course_match_key(row['name'])
                entry = {'href': row['href'], 'plan': plan_href}
                if entry not in index[slug][aa][key]:
                    index[slug][aa][key].append(entry)
    return index, len(owners)


def teachers_for(href: str, targets: list[str], course_name: str, historical_index):
    """Docenti dell'insegnamento per l'offerta corrente e i tre A.A. precedenti.

    Il record principale resta l'edizione più recente disponibile; ``history``
    conserva però tutte le associazioni verificate, così il database non perde
    la cronologia docente-insegnamento usata dagli studenti per appunti meno
    recenti.
    """
    allowed_years = (PLAN_ACADEMIC_YEAR, *FALLBACK_ACADEMIC_YEARS)
    history_by_aa = {}

    def remember(parsed, source, source_plan, match_method):
        if not parsed or not parsed.get('teachers') or parsed.get('aa') not in allowed_years:
            return False
        aa = parsed['aa']
        if aa in history_by_aa:
            return False
        history_by_aa[aa] = {
            **parsed,
            'source': source,
            'source_plan': source_plan,
            'match_method': match_method,
        }
        return True

    html = fetch(href)
    parsed = parse_teachers(html)
    remember(parsed, href, None, 'current')

    course_key = course_match_key(course_name)
    for aa in FALLBACK_ACADEMIC_YEARS:
        for candidate in historical_index.get(aa, {}).get(course_key, []):
            cand = candidate['href']
            h2 = fetch(cand)
            if h2 == '__404__':
                continue
            p2 = parse_teachers(h2)
            if (
                p2 and p2['teachers']
                and page_course_key(h2) == course_key
                and page_matches_degree(h2, targets)
            ):
                remember(p2, cand, candidate['plan'], 'historical_plan')
                break

    history = [history_by_aa[aa] for aa in allowed_years if aa in history_by_aa]
    if history:
        return {**history[0], 'history': history}
    return {
        **(parsed or {'aa': None, 'teachers': []}),
        'source': href,
        'source_plan': None,
        'match_method': 'unavailable',
        'history': [],
    }


def main():
    programs = json.load(open(os.path.join(SCRATCH, 'programs.json')))
    if len(sys.argv) > 1:  # test su singoli slug
        only = set(sys.argv[1:])
        programs = [p for p in programs if p['slug'] in only]

    catalog = {}
    degree_html = {}
    for p in programs:
        html = fetch(p['unimi_path'])
        degree_html[p['slug']] = html
        rows = parse_degree_page(html) if html != '__404__' else []
        catalog[p['slug']] = rows
        print(f"{p['slug']}: {len(rows)} righe piano", flush=True)

    historical_index, historical_plan_count = build_historical_course_index(programs, degree_html)
    print(f'piani storici ufficiali indicizzati: {historical_plan_count}', flush=True)
    by_targets = {p['slug']: degree_match_targets(p['name'], p.get('cds_match')) for p in programs}
    # chiave (degree, href): il probe dei suffissi dipende dal CdS
    pairs = sorted({(slug, r['href']) for slug, rows in catalog.items() for r in rows})
    pair_names = defaultdict(set)
    for slug, rows in catalog.items():
        for row in rows:
            pair_names[(slug, row['href'])].add(row['name'])
    print(f"coppie corso-insegnamento: {len(pairs)}", flush=True)
    pair_signature = hashlib.sha256(
        '\n'.join(f'{slug}|{href}' for slug, href in pairs).encode()
    ).hexdigest()
    checkpoint_signature = {
        'pipeline_version': PIPELINE_VERSION,
        'plan_academic_year': PLAN_ACADEMIC_YEAR,
        'pair_signature': pair_signature,
    }
    checkpoint_path = os.path.join(SCRATCH, 'teachers.partial.json')
    teachers = {}
    if os.path.exists(checkpoint_path):
        try:
            checkpoint = json.load(open(checkpoint_path, encoding='utf-8'))
            if checkpoint.get('signature') == checkpoint_signature:
                teachers = {
                    key: value
                    for key, value in checkpoint.get('teachers', {}).items()
                    if key in {f'{slug}|{href}' for slug, href in pairs}
                    and value.get('match_method') != 'error'
                }
                print(f'ripresa checkpoint docenti: {len(teachers)}/{len(pairs)}', flush=True)
        except (OSError, ValueError, TypeError):
            teachers = {}
    pending_pairs = [(slug, href) for slug, href in pairs if f'{slug}|{href}' not in teachers]
    done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {
            pool.submit(
                teachers_for,
                href,
                by_targets[slug],
                sorted(pair_names[(slug, href)], key=len)[0],
                historical_index.get(slug, {}),
            ): (slug, href)
            for slug, href in pending_pairs
        }
        for fut in as_completed(futures):
            slug, h = futures[fut]
            try:
                teachers[f'{slug}|{h}'] = fut.result()
            except Exception as e:
                teachers[f'{slug}|{h}'] = {
                    'aa': None,
                    'teachers': [],
                    'source': h,
                    'source_plan': None,
                    'match_method': 'error',
                    'error': str(e),
                }
            done += 1
            if done % 100 == 0:
                atomic_json_dump(checkpoint_path, {
                    'signature': checkpoint_signature,
                    'teachers': teachers,
                })
            if done % 200 == 0:
                print(f"docenti: {len(teachers)}/{len(pairs)}", flush=True)

    output = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'source_domain': BASE,
            'plan_academic_year': PLAN_ACADEMIC_YEAR,
            'fallback_academic_years': list(FALLBACK_ACADEMIC_YEARS),
            'historical_plans_indexed': historical_plan_count,
        },
        'catalog': catalog,
        'teachers': teachers,
    }
    out_path = os.path.join(SCRATCH, 'catalog.json')
    atomic_json_dump(out_path, output)
    if os.path.exists(checkpoint_path):
        os.remove(checkpoint_path)
    n_teach = sum(1 for t in teachers.values() if t['teachers'])
    aa_counts = Counter(
        edition['aa']
        for result in teachers.values()
        for edition in result.get('history', [])
    )
    historical_links = sum(
        len(edition['teachers'])
        for result in teachers.values()
        for edition in result.get('history', [])
    )
    print(f"FATTO: {sum(len(r) for r in catalog.values())} righe piano, {len(pairs)} coppie, {n_teach} con docenti", flush=True)
    print(f"A.A. coperti: {dict(sorted(aa_counts.items(), reverse=True))} | associazioni storiche: {historical_links}", flush=True)


if __name__ == '__main__':
    main()
