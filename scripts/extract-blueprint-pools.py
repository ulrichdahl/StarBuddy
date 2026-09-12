#!/usr/bin/env python3
"""Build database/data/blueprint-pools.json from the game's own DataCore.

Blueprints are not bought: with eight exceptions every recipe in the game is
handed out by a mission, and the game decides which one from a weighted pool.
Three record types carry that, and the join between them is what this script
writes out:

  BlueprintPoolRecord   libs/foundry/records/crafting/blueprintrewards/**
                        a pool: `blueprintRewards`, each a blueprint record
                        path and a `weight`
  ContractGenerator     libs/foundry/records/contracts/contractgenerator/**
                        the repeatable career missions. A contract's
                        `contractResults` may hold a `BlueprintRewards` entry
                        naming a pool and a `chance`
  ScenarioProgress      libs/foundry/records/contracts/contractscenarios/**
                        limited-time events. `tierRewards` award pools at a
                        `minPoints` threshold

Mission titles and contractor names are localization keys resolved against
global.ini.

Usage (see the extraction notes in the project memory):

    unp4k extract "<Data.p4k>" "*.dcb" -o /tmp/dcb
    starbreaker dcb extract --dcb "/tmp/dcb/Data\\Game2.dcb" -o ~/sc-dcb-xml --format xml
    ~/Games/star-citizen/extract-global-ini.sh          # or use an existing global-*.ini
    scripts/extract-blueprint-pools.py ~/sc-dcb-xml <global.ini> <patch>
"""
import collections
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date

OUT = os.path.join(os.path.dirname(__file__), '..', 'backend', 'database', 'data', 'blueprint-pools.json')

# A title is written for the mobiGlas, which substitutes the target and place
# at generation time. Nothing here can, so the hole reads as one.
PLACEHOLDER = re.compile(r'~mission\([^)]*\)')
MARKUP = re.compile(r'</?EM\d*>')


def load_ini(path):
    loc = {}
    for line in open(path, encoding='utf-8-sig', errors='replace'):
        if '=' in line:
            key, _, value = line.partition('=')
            loc[key.strip().lower()] = value.strip()
    return loc


def clean(text):
    if not text:
        return None
    text = MARKUP.sub('', PLACEHOLDER.sub('…', text)).strip()
    return text or None


def params(node):
    """The `param`/`value` pairs of a ContractParamOverrides block."""
    out = {}
    if node is None:
        return out
    for item in node.iter('Item'):
        key, value = item.findtext('param'), item.findtext('value')
        if key and key not in out:
            out[key] = value
    return out


def read_pools(root):
    pools = {}
    for path in glob.glob(root + '/libs/foundry/records/crafting/blueprintrewards/**/*.xml', recursive=True):
        tree = ET.parse(path)
        record = tree.getroot().findtext('_RecordName_') or ''
        if not record.startswith('BlueprintPoolRecord.'):
            continue
        rewards = []
        for item in tree.iter('Item'):
            if item.findtext('_Type_') != 'BlueprintReward':
                continue
            key = os.path.basename(item.findtext('blueprintRecord') or '').rsplit('.', 1)[0]
            if key:
                rewards.append({'key': key, 'weight': float(item.findtext('weight') or 0)})
        pools[os.path.basename(path).rsplit('.', 1)[0]] = {'record': record, 'blueprints': rewards}
    return pools


def read_contracts(root, loc):
    """Every (pool, contractor, mission title) a contract generator awards."""
    hits = []
    for path in glob.glob(root + '/libs/foundry/records/contracts/**/*.xml', recursive=True):
        if 'blueprintPool' not in open(path, encoding='utf-8', errors='replace').read():
            continue
        tree = ET.parse(path)
        parents = {child: parent for parent in tree.iter() for child in parent}
        for node in tree.iter():
            if node.findtext('_Type_') != 'BlueprintRewards':
                continue
            # Walk out to the contract this result belongs to, and on to the
            # generator, which is where the contractor's name is set.
            cur, contract, generator = node, None, None
            while cur is not None:
                kind = cur.findtext('_Type_') or ''
                if contract is None and 'Contract' in kind and kind not in ('ContractResults', 'ContractGenerator') and 'Handler' not in kind:
                    contract = cur
                if 'Handler' in kind or kind == 'ContractGenerator':
                    generator = cur
                    break
                cur = parents.get(cur)
            over = params(contract.find('paramOverrides')) if contract is not None else {}
            gen = params(generator.find('contractParams')) if generator is not None else {}
            resolve = lambda key: loc.get((key or '').lstrip('@').lower())
            hits.append({
                'pool': os.path.basename(node.findtext('blueprintPool') or '').rsplit('.', 1)[0],
                'chance': float(node.findtext('chance') or 0),
                'contractor': clean(resolve(gen.get('Contractor')) or resolve(over.get('Contractor'))),
                'mission': clean(resolve(over.get('Title'))),
            })
    return hits


def read_scenarios(root):
    """Event progression tiers, which award pools at a points threshold."""
    tiers = []
    for path in glob.glob(root + '/libs/foundry/records/contracts/contractscenarios/*.xml', recursive=True):
        if 'blueprintPool' not in open(path, encoding='utf-8', errors='replace').read():
            continue
        tree = ET.parse(path)
        record = tree.getroot().findtext('_RecordName_') or ''
        event = record.split('.')[-1].replace('_ScenarioProgress', '')
        for node in tree.iter():
            if node.findtext('_Type_') != 'STierReward':
                continue
            listed = node.find('blueprintPool')
            for item in listed if listed is not None else []:
                tiers.append({
                    'pool': os.path.basename(item.text or '').rsplit('.', 1)[0],
                    'event': event,
                    'min_points': int(float(node.findtext('minPoints') or 0)),
                })
    return tiers


def main():
    root, ini, patch = sys.argv[1], sys.argv[2], sys.argv[3]
    loc = load_ini(ini)
    pools = read_pools(root)
    hits = read_contracts(root, loc)
    tiers = read_scenarios(root)

    by_pool = collections.defaultdict(list)
    for hit in hits:
        by_pool[hit['pool']].append(hit)
    events = collections.defaultdict(list)
    for tier in tiers:
        events[tier['pool']].append(tier)

    out = []
    for key, pool in sorted(pools.items()):
        sources = []
        # One source per contractor: a pool is usually reachable from a dozen
        # missions of theirs, and the player picks the one they like.
        for contractor, group in sorted(collections.Counter(h['contractor'] for h in by_pool[key]).items(), key=lambda kv: -kv[1]):
            missions = sorted({h['mission'] for h in by_pool[key] if h['contractor'] == contractor and h['mission']})
            sources.append({
                'kind': 'contract',
                'contractor': contractor,
                'chance': max(h['chance'] for h in by_pool[key] if h['contractor'] == contractor),
                'missions': missions,
            })
        for tier in sorted(events[key], key=lambda t: t['min_points']):
            sources.append({'kind': 'event', 'event': tier['event'], 'min_points': tier['min_points']})
        out.append({'key': key, 'record': pool['record'], 'blueprints': pool['blueprints'], 'sources': sources})

    payload = {
        '_meta': {
            'patch': patch,
            'updated': date.today().isoformat(),
            'source': 'Data.p4k > Game2.dcb > BlueprintPoolRecord + ContractGenerator + ScenarioProgress, '
                      'mission titles and contractors resolved against global.ini',
            'notes': 'Regenerate with scripts/extract-blueprint-pools.py after a game patch, then run '
                     'php artisan starbuddy:sync-blueprint-pools.',
            'generator': 'scripts/extract-blueprint-pools.py',
        },
        'pools': out,
    }
    with open(os.path.abspath(OUT), 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write('\n')

    awarded = [p for p in out if p['sources']]
    print(f"{len(out)} pools, {len(awarded)} awarded by something, "
          f"{len({b['key'] for p in out for b in p['blueprints']})} distinct blueprints")
    print(f"wrote {os.path.abspath(OUT)}")


if __name__ == '__main__':
    main()
