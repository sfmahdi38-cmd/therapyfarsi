import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const versionOf = (pkg: string) =>
  (JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8')) as { version: string; devDependencies?: Record<string, string> });

const minor = (v: string) => v.replace(/^[^\d]*/, '').split('.').slice(0, 2).map(Number) as [number, number];

describe('OpenNext compatibility', () => {
  // OpenNext's peer range allows any Next >=16.3.8, but its manifest patch only knows the files of the
  // Next version it is tested with. Next 16.4 added preview-props.json and the Worker crashed (error 1101).
  it('Next is not newer than the version OpenNext is tested against', () => {
    const tested = versionOf('@opennextjs/aws').devDependencies?.next;
    expect(tested).toBeDefined();
    const [tMaj, tMin] = minor(tested!);
    const [maj, min] = minor(versionOf('next').version);
    expect(maj < tMaj || (maj === tMaj && min <= tMin), `next ${versionOf('next').version} vs tested ${tested}`).toBe(true);
  });
});
