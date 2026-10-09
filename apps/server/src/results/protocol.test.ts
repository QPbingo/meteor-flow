import { describe, expect, it } from 'vitest';
import { limits, parseResult } from './protocol.js';
import { result } from '../../../../tests/fixtures/storage-support.js';

const declaration = () => result('task-1', 'attempt-1');
const parse = (value: unknown) => parseResult(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), 'task-1', 'attempt-1');

describe('strict attempt-bound result declaration', () => {
  it('accepts a complete summary without file artifacts (V10)', () => {
    expect(parse(declaration())).toEqual(declaration());
  });
  it.each([
    ['unknown version', { protocol: 'meteor-flow.result/v2' }],
    ['wrong task', { task_id: 'other-task' }],
    ['old attempt', { attempt_id: 'old-attempt' }],
    ['unknown outcome', { outcome: 'cancelled' }],
    ['missing summary', { summary: '' }],
    ['unknown property', { extra: 'unrecognized' }],
  ])('rejects %s (V09/V13/V27)', (_name, changes) => {
    expect(() => parse({ ...declaration(), ...changes })).toThrow();
  });
  it.each([
    '{"protocol":"meteor-flow.result/v1","protocol":"meteor-flow.result/v1"}',
    JSON.stringify(declaration()).replace('"summary":"已完成"', '"summary":"first","summary":"second"'),
    JSON.stringify({ ...declaration(), artifacts: [{ root_id: 'workdir', path: 'file.txt', label: 'report' }] }).replace('"path":"file.txt"', '"path":"first.txt","path":"file.txt"'),
    JSON.stringify(declaration()).replace('"summary":"已完成"', '"summary":"first","summ\\u0061ry":"second"'),
  ])('rejects duplicate JSON keys before object construction', source => {
    expect(() => parse(source)).toThrow(/重复字段/);
  });
  it.each([
    '{"protocol":',
    JSON.stringify(declaration()).replace('{', '{/*comment*/'),
    JSON.stringify(declaration()).replace('"artifacts":[]', '"artifacts":[],') ,
    `${JSON.stringify(declaration())} ${JSON.stringify(declaration())}`,
  ])('rejects partial, commented, trailing-comma and trailing-value JSON', source => {
    expect(() => parse(source)).toThrow();
  });
  it('rejects malformed UTF-8 rather than replacing bytes', () => {
    expect(() => parseResult(Buffer.from([0xff, 0xfe]), 'task-1', 'attempt-1')).toThrow();
  });
  it('rejects duplicate artifact ownership paths and more than 100 files', () => {
    const artifact = { root_id: 'workdir', path: 'report.txt', label: '报告' };
    expect(() => parse({ ...declaration(), artifacts: [artifact, { ...artifact, label: '另一个名称' }] })).toThrow(/不能重复/);
    expect(() => parse({ ...declaration(), artifacts: Array.from({ length: 101 }, (_, i) => ({ ...artifact, path: `${i}.txt` })) })).toThrow();
  });
  it('uses the confirmed 1 MiB result-file limit', () => {
    expect(limits.result).toBe(1024 * 1024);
  });
  it('enforces the confirmed summary limit in UTF-8 bytes', () => {
    const summary = '中'.repeat(11_000);
    expect(Buffer.byteLength(summary)).toBeGreaterThan(32 * 1024);
    expect(() => parse({ ...declaration(), summary })).toThrow();
  });
});
