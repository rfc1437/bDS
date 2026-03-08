"""
Audit translation quality — run inside bDS Python runtime.

Flags posts where translation content is suspicious:
  - Canonical body is empty/tiny but translation has substantial content (hallucination)
  - Translation is much longer than canonical (ratio > 3x)
  - Canonical is macro-only but translation contains prose
"""

from bds_api import bds

MACRO_PATTERN = r'^\s*(\[\[.*?\]\]\s*)+$'
SIZE_RATIO_THRESHOLD = 3.0
MIN_HALLUCINATION_SIZE = 200  # translation must be at least this big to flag


async def audit():
    import re

    # Get all published posts, paginated
    all_posts = []
    offset = 0
    limit = 100
    while True:
        result = await bds.posts.get_all(options={'limit': limit, 'offset': offset})
        items = result.get('items', result) if isinstance(result, dict) else result
        if isinstance(result, dict):
            all_posts.extend(result['items'])
            if not result.get('hasMore', False):
                break
        else:
            all_posts.extend(result)
            if len(result) < limit:
                break
        offset += limit

    print(f"Total posts: {len(all_posts)}")

    suspicious = []

    for post in all_posts:
        langs = post.get('availableLanguages', [])
        canonical_lang = post.get('language', '')

        # Only check posts that have translations
        translation_langs = [l for l in langs if l != canonical_lang]
        if not translation_langs:
            continue

        canonical_content = post.get('content', '') or ''
        canonical_len = len(canonical_content.strip())
        canonical_is_macro = bool(re.match(MACRO_PATTERN, canonical_content.strip(), re.DOTALL)) if canonical_content.strip() else False
        canonical_is_empty = canonical_len < 20

        # Get translations for this post
        translations = await bds.posts.get_translations(post_id=post['id'])
        if not translations:
            continue

        for tr in translations:
            tr_content = tr.get('content', '') or ''
            tr_len = len(tr_content.strip())
            tr_lang = tr.get('language', '?')
            reasons = []

            # Check 1: empty/tiny canonical but substantial translation
            if canonical_is_empty and tr_len > MIN_HALLUCINATION_SIZE:
                reasons.append(f"empty canonical ({canonical_len}b) but translation has {tr_len}b")

            # Check 2: macro-only canonical but translation has prose
            if canonical_is_macro and tr_len > MIN_HALLUCINATION_SIZE:
                tr_is_macro = bool(re.match(MACRO_PATTERN, tr_content.strip(), re.DOTALL))
                if not tr_is_macro:
                    reasons.append(f"canonical is macro-only but translation has prose ({tr_len}b)")

            # Check 3: translation is disproportionately longer
            if canonical_len > 20 and tr_len > 0:
                ratio = tr_len / canonical_len
                if ratio > SIZE_RATIO_THRESHOLD:
                    reasons.append(f"translation is {ratio:.1f}x longer ({canonical_len}b → {tr_len}b)")

            if reasons:
                suspicious.append({
                    'slug': post.get('slug', ''),
                    'title': post.get('title', ''),
                    'canonical_lang': canonical_lang,
                    'translation_lang': tr_lang,
                    'canonical_len': canonical_len,
                    'translation_len': tr_len,
                    'reasons': reasons,
                })

    # Print results
    print(f"\nChecked {len(all_posts)} posts")
    print(f"Found {len(suspicious)} suspicious translations:\n")

    for s in suspicious:
        print(f"  {s['slug']}  ({s['canonical_lang']}→{s['translation_lang']})")
        print(f"    title: {s['title']}")
        print(f"    sizes: canonical={s['canonical_len']}b, translation={s['translation_len']}b")
        for r in s['reasons']:
            print(f"    ⚠ {r}")
        print()


await audit()
