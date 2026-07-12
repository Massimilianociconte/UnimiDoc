#!/usr/bin/env python3
"""Scraper piani di studio UniMi: per ogni CdL triennale estrae insegnamenti
(anno, CFU, ore, lingua, SSD, curriculum, periodo) dalla pagina del corso e i
docenti dalla pagina di ogni insegnamento (fallback all'A.A. precedente se
l'edizione corrente non ha docenti assegnati)."""

import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape

BASE = 'https://www.unimi.it'
SCRATCH = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SCRATCH, 'cache')
os.makedirs(CACHE, exist_ok=True)
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 UnimiDocCatalog/1.0'}


def fetch(path: str) -> str:
    key = re.sub(r'[^a-z0-9]+', '_', path.lower()).strip('_')[:180]
    cpath = os.path.join(CACHE, key + '.html')
    if os.path.exists(cpath):
        return open(cpath, encoding='utf-8', errors='replace').read()
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                html = res.read().decode('utf-8', errors='replace')
            open(cpath, 'w', encoding='utf-8').write(html)
            return html
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(cpath, 'w', encoding='utf-8').write('__404__')
                return '__404__'
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    open(cpath, 'w', encoding='utf-8').write('__404__')
    return '__404__'


def text_of(fragment: str) -> str:
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]+>', ' ', fragment))).strip()


def parse_degree_page(html: str):
    """Estrae i piani didattici: lista di insegnamenti con curriculum/anno/periodo."""
    out = []
    # Panels "Piano didattico [curriculum]" dentro curr-accordion
    panel_re = re.compile(r'<a[^>]*class="panel-title"[^>]*href="#(curr-[^"]+)"[^>]*>(.*?)</a>', re.S)
    panels = [(m.group(1), text_of(m.group(2))) for m in panel_re.finditer(html)]
    for panel_id, panel_title in panels:
        body_start = html.find(f'id="{panel_id}"')
        if body_start < 0:
            continue
        next_panel = html.find('panel-heading', body_start + 10)
        body = html[body_start:next_panel if next_panel > 0 else len(html)]
        curriculum = re.sub(r'^Piano didattico\s*', '', panel_title).strip(' -–')
        # Tabs anno: <li ...><a ... href="#ugov-of-pd-year-...">... Anno: N
        year_ids = re.findall(r'href="#(ugov-of-pd-year[^"]+)"[^>]*>\s*<div>\s*(?:Anno:\s*(\d+)|([^<]+?))\s*</div>', body)
        for tab_id, year_num, alt_label in year_ids:
            tab_start = body.find(f'id="{tab_id}"')
            if tab_start < 0:
                continue
            tab_end = body.find('id="ugov-of-pd-year', tab_start + 10)
            tab = body[tab_start:tab_end if tab_end > 0 else len(body)]
            year = int(year_num) if year_num else 0  # 0 = non annuale (es. "Attività conclusive")
            year_label = alt_label.strip() if alt_label else f'Anno {year_num}'
            # Sezioni periodo: <div class="top30 titoletto">Primo semestre</div>
            # Righe subtitle: <tr class="rowsubtitle ...">Obbligatorio</tr>
            pos = 0
            period = ''
            grouping = ''
            token_re = re.compile(
                r'(?:<div class="top30 titoletto">(?P<period>[^<]*)</div>)'
                r'|(?:<tr class="rowsubtitle[^"]*">\s*<td[^>]*>(?P<group>.*?)</td>)'
                r'|(?:<tr>\s*<td class="cdl-title"[^>]*>\s*<a href="(?P<href>/it/corsi/insegnamenti-dei-corsi-di-laurea/\d+/[^"]+)">(?P<name>.*?)</a>\s*</td>\s*'
                r'<td[^>]*>(?P<cfu>.*?)</td>\s*<td[^>]*>(?P<hours>.*?)</td>\s*<td[^>]*>(?P<lang>.*?)</td>\s*<td[^>]*>(?P<ssd>.*?)</td>)',
                re.S)
            for m in token_re.finditer(tab):
                if m.group('period') is not None:
                    period = text_of(m.group('period'))
                elif m.group('group') is not None:
                    grouping = text_of(m.group('group'))
                else:
                    out.append({
                        'curriculum': curriculum,
                        'year': year,
                        'year_label': year_label,
                        'period': period,
                        'grouping': grouping,
                        'href': m.group('href'),
                        'name': text_of(m.group('name')),
                        'cfu': text_of(m.group('cfu')),
                        'hours': text_of(m.group('hours')),
                        'lang': text_of(m.group('lang')),
                        'ssd': text_of(m.group('ssd')),
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


CDS_RE = re.compile(r'>([^<>]{3,120})\s*\(Classe\s+([A-Za-z0-9/&#;-]+)\)')


def norm(s: str) -> str:
    s = unescape(s).lower()
    s = re.sub(r'[àáâ]', 'a', s)
    s = re.sub(r'[èéê]', 'e', s)
    s = re.sub(r'[ìíî]', 'i', s)
    s = re.sub(r'[òóô]', 'o', s)
    s = re.sub(r'[ùúû]', 'u', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def page_matches_degree(html: str, degree_name: str) -> bool:
    target = norm(degree_name)
    for m in CDS_RE.finditer(html):
        if norm(m.group(1)) == target:
            return True
    return False


def teachers_for(href: str, degree_name: str):
    """Docenti dell'insegnamento. L'href del piano punta all'offerta più
    recente (spesso senza docenti assegnati): in tal caso cerca il nodo
    dell'A.A. corrente dello STESSO CdS provando i suffissi Drupal."""
    html = fetch(href)
    parsed = parse_teachers(html)
    if parsed and parsed['teachers']:
        return {**parsed, 'source': href}
    m = re.match(r'(/it/corsi/insegnamenti-dei-corsi-di-laurea/)(\d+)/(.+?)(?:-(\d+))?$', href)
    if m:
        prefix, year, base = m.group(1), int(m.group(2)), m.group(3)
        candidates = [f'{prefix}{year - 1}/{base}'] + [f'{prefix}{year - 1}/{base}-{k}' for k in range(0, 9)]
        for cand in candidates:
            h2 = fetch(cand)
            if h2 == '__404__':
                continue
            p2 = parse_teachers(h2)
            if p2 and p2['teachers'] and page_matches_degree(h2, degree_name):
                return {**p2, 'source': cand}
    return {**(parsed or {'aa': None, 'teachers': []}), 'source': href}


def main():
    programs = json.load(open(os.path.join(SCRATCH, 'programs.json')))
    if len(sys.argv) > 1:  # test su singoli slug
        only = set(sys.argv[1:])
        programs = [p for p in programs if p['slug'] in only]

    catalog = {}
    for p in programs:
        html = fetch(p['unimi_path'])
        rows = parse_degree_page(html) if html != '__404__' else []
        catalog[p['slug']] = rows
        print(f"{p['slug']}: {len(rows)} righe piano", flush=True)

    by_name = {p['slug']: p['name'] for p in programs}
    # chiave (degree, href): il probe dei suffissi dipende dal CdS
    pairs = sorted({(slug, r['href']) for slug, rows in catalog.items() for r in rows})
    print(f"coppie corso-insegnamento: {len(pairs)}", flush=True)
    teachers = {}
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(teachers_for, h, by_name[slug]): (slug, h) for slug, h in pairs}
        for fut in as_completed(futures):
            slug, h = futures[fut]
            try:
                teachers[f'{slug}|{h}'] = fut.result()
            except Exception as e:
                teachers[f'{slug}|{h}'] = {'aa': None, 'teachers': [], 'source': h, 'error': str(e)}
            done += 1
            if done % 200 == 0:
                print(f"docenti: {done}/{len(pairs)}", flush=True)

    json.dump({'catalog': catalog, 'teachers': teachers}, open(os.path.join(SCRATCH, 'catalog.json'), 'w'), ensure_ascii=False)
    n_teach = sum(1 for t in teachers.values() if t['teachers'])
    print(f"FATTO: {sum(len(r) for r in catalog.values())} righe piano, {len(pairs)} coppie, {n_teach} con docenti", flush=True)


if __name__ == '__main__':
    main()
