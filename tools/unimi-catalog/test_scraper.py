#!/usr/bin/env python3
"""Regression test offline per il parser del catalogo ufficiale UniMi."""

import unittest
from unittest.mock import patch

import scraper


def offer_page(*labels: str) -> str:
    return ''.join(
        f'<a href="/it/corsi/altre_offerte/aa-2025/2026/test-{i}">{label}</a>'
        for i, label in enumerate(labels)
    )


class CatalogMatcherTests(unittest.TestCase):
    def test_class_label_is_removed_even_with_spaces_and_r(self):
        label = 'Giurisprudenza c.u. (Classe LMG/01 R)'
        self.assertEqual(scraper.degree_name_from_offer_label(label), 'giurisprudenza c u')

    def test_editorial_offer_suffix_does_not_change_course_identity(self):
        self.assertEqual(
            scraper.course_match_key('Diritto commerciale (of2)'),
            scraper.course_match_key('Diritto commerciale'),
        )

    def test_medical_campuses_are_strictly_separated(self):
        html = offer_page('Medicina e chirurgia - Polo Centrale (Classe LM-41 R)')
        central = scraper.degree_match_targets(
            'Medicina e chirurgia - Polo Centrale',
            'medicina e chirurgia polo centrale',
        )
        san_paolo = scraper.degree_match_targets(
            'Medicina e chirurgia - Polo San Paolo',
            'medicina e chirurgia polo san paolo',
        )
        self.assertTrue(scraper.page_matches_degree(html, central))
        self.assertFalse(scraper.page_matches_degree(html, san_paolo))

    def test_degree_prefix_does_not_match_a_different_degree(self):
        html = offer_page('Chimica industriale (Classe L-27 R)')
        self.assertFalse(scraper.page_matches_degree(html, ['chimica']))
        self.assertTrue(scraper.page_matches_degree(html, ['chimica industriale']))

    def test_cycle_unique_editorial_suffix_is_allowed(self):
        html = offer_page('Giurisprudenza c.u. (Classe LMG/01 R)')
        self.assertTrue(scraper.page_matches_degree(html, ['giurisprudenza']))

    def test_explicit_match_never_falls_back_to_generic_degree_name(self):
        targets = scraper.degree_match_targets(
            'Medicina e chirurgia - Polo Vialba',
            'medicina e chirurgia polo vialba',
        )
        self.assertEqual(targets, ['medicina e chirurgia polo vialba'])

    def test_historical_plans_are_recent_first_and_unimi_only(self):
        html = ''.join([
            '<a href="/it/corsi/altre_offerte/aa-2025/2026/giurisprudenza">2025/26</a>',
            '<a href="/it/corsi/altre_offerte/aa-2024/2025/giurisprudenza">2024/25</a>',
            '<a href="https://example.org/external-plan">esterno</a>',
        ])
        self.assertEqual(
            scraper.historical_plan_links(html),
            [
                ('2025/2026', '/it/corsi/altre_offerte/aa-2025/2026/giurisprudenza'),
                ('2024/2025', '/it/corsi/altre_offerte/aa-2024/2025/giurisprudenza'),
            ],
        )

    def test_teacher_history_keeps_all_available_academic_years(self):
        current = '/it/corsi/insegnamenti-dei-corsi-di-laurea/2027/example'
        old_1 = '/it/corsi/insegnamenti-dei-corsi-di-laurea/2026/example'
        old_2 = '/it/corsi/insegnamenti-dei-corsi-di-laurea/2025/example'
        pages = {current: current, old_1: old_1, old_2: old_2}
        parsed = {
            current: {'aa': '2026/2027', 'teachers': [{'slug': 'a', 'name': 'A', 'role': 'responsabile'}]},
            old_1: {'aa': '2025/2026', 'teachers': [{'slug': 'b', 'name': 'B', 'role': 'responsabile'}]},
            old_2: {'aa': '2024/2025', 'teachers': [{'slug': 'c', 'name': 'C', 'role': 'responsabile'}]},
        }
        index = {
            '2025/2026': {'example': [{'href': old_1, 'plan': '/plan/2025'}]},
            '2024/2025': {'example': [{'href': old_2, 'plan': '/plan/2024'}]},
        }

        with (
            patch.object(scraper, 'fetch', side_effect=lambda path: pages.get(path, '__404__')),
            patch.object(scraper, 'parse_teachers', side_effect=lambda html: parsed.get(html)),
            patch.object(scraper, 'page_course_key', return_value='example'),
            patch.object(scraper, 'page_matches_degree', return_value=True),
        ):
            result = scraper.teachers_for(current, ['example degree'], 'Example', index)

        self.assertEqual(result['aa'], '2026/2027')
        self.assertEqual(
            [edition['aa'] for edition in result['history']],
            ['2026/2027', '2025/2026', '2024/2025'],
        )


if __name__ == '__main__':
    unittest.main()
