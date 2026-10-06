---
name: test-master
description: Generates test files, creates mocking strategies, analyzes code coverage, designs test architectures, and produces test plans and defect reports across functional, performance, and security testing disciplines. Use when writing unit tests, integration tests, or E2E tests; creating test strategies or automation frameworks; analyzing coverage gaps; performance testing with k6 or Artillery; security testing with OWASP methods; debugging flaky tests; or working on QA, regression, test automation, quality gates, shift-left testing, or test maintenance.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  company: https://synergetic.solutions
  version: "1.1.1"
  domain: quality
  triggers: test, testing, QA, unit test, integration test, E2E, coverage, performance test, security test, regression, test strategy, test automation, test framework, quality metrics, defect, exploratory, usability, accessibility, localization, manual testing, shift-left, quality gate, flaky test, test maintenance
  role: specialist
  scope: testing
  output-format: report
  related-skills: fullstack-guardian, playwright-expert, devops-engineer, debugging-wizard, code-reviewer, feature-forge
---

# Test Master

Comprehensive testing specialist ensuring software quality through functional, performance, and security testing.


## Meteor Flow 项目适配（2026-10-06）

执行前读取仓库 `AGENTS.md` 和 `.agents/skills/meteor-flow-verification/SKILL.md`，适用性与结果必须按项目六类场景记录。
使用条件见 `tasks/002-development-workflow/skill-prerequisites.md`：编写/修改可执行代码与测试前准备策略和能力，验证阶段实际执行；纯文档不强制新增无关测试。
若当前 agent 尚未加载此项目技能、引用或必需工具，先按前置要求引入并验证再开发；不能仅因个人环境有同名技能就视为就绪。
本项目覆盖上游以下默认要求：v1 在本地实际运行测试，不新增 CI/CD；CI 为后续事项。
测试框架随已确认产品技术栈选择，文中 Jest/pytest 等仅为示例。只在单元测试中 mock 外部依赖；集成和 E2E 使用隔离测试环境。
禁止把 flaky 测试重跑为绿当成修复；保留首次失败和根因。TDD 引用不授权删除既有实现或撤销用户工作。
先核对专用临时目录、测试数据库/命名空间与端口，清理只作用于本次资源；不能使用生产数据或默认连接真实业务库。
related-skills 元数据不是安装依赖，不安装整个上游套件。


## Core Workflow

1. **Define scope** — Identify what to test and which testing types apply
2. **Create strategy** — Plan the test approach across functional, performance, and security perspectives
3. **Write tests** — Implement tests with proper assertions (see example below)
4. **Execute** — Run tests and collect results
   - If tests fail: classify the failure (assertion error vs. environment/flakiness), fix root cause, re-run
   - If tests are flaky: isolate ordering dependencies, check async handling, add retry or stabilization logic
5. **Report** — Document findings with severity ratings and actionable fix recommendations
   - Verify coverage targets are met before closing; flag gaps explicitly

## Quick-Start Example

A minimal Jest unit test illustrating the key patterns this skill enforces:

```js
// ✅ Good: meaningful description, specific assertion, isolated dependency
describe('calculateDiscount', () => {
  it('applies 10% discount for premium users', () => {
    const result = calculateDiscount({ price: 100, userTier: 'premium' });
    expect(result).toBe(90); // specific outcome, not just truthy
  });

  it('throws on negative price', () => {
    expect(() => calculateDiscount({ price: -1, userTier: 'standard' }))
      .toThrow('Price must be non-negative');
  });
});
```

Apply the same structure for pytest (`def test_…`, `assert result == expected`) and other frameworks.

## Reference Guide

Load detailed guidance based on context:

<!-- TDD Iron Laws and Testing Anti-Patterns adapted from obra/superpowers by Jesse Vincent (@obra), MIT License -->

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Unit Testing | `references/unit-testing.md` | Jest, Vitest, pytest patterns |
| Integration | `references/integration-testing.md` | API testing, Supertest |
| E2E | `references/e2e-testing.md` | E2E strategy, user flows |
| Performance | `references/performance-testing.md` | k6, load testing |
| Security | `references/security-testing.md` | Security test checklist |
| Reports | `references/test-reports.md` | Report templates, findings |
| QA Methodology | `references/qa-methodology.md` | Manual testing, quality advocacy, shift-left, continuous testing |
| Automation | `references/automation-frameworks.md` | Framework patterns, scaling, maintenance, team enablement |
| TDD Iron Laws | `references/tdd-iron-laws.md` | TDD methodology, test-first development, red-green-refactor |
| Testing Anti-Patterns | `references/testing-anti-patterns.md` | Test review, mock issues, test quality problems |

## Constraints

**MUST DO**
- Test happy paths AND error/edge cases (e.g., empty input, null, boundary values)
- Mock external dependencies — never call real APIs or databases in unit tests
- Use meaningful `it('…')` descriptions that read as plain-English specifications
- Assert specific outcomes (`expect(result).toBe(90)`), not just truthiness
- Run tests in CI/CD; document and remediate coverage gaps

**MUST NOT**
- Skip error-path testing (e.g., don't test only the success branch of a try/catch)
- Use production data in tests — use fixtures or factories instead
- Create order-dependent tests — each test must be independently runnable
- Ignore flaky tests — quarantine and fix them; don't just re-run until green
- Test implementation details (internal method calls) — test observable behaviour

## Output Templates

When creating test plans, provide:
1. Test scope and approach
2. Test cases with expected outcomes
3. Coverage analysis
4. Findings with severity (Critical/High/Medium/Low)
5. Specific fix recommendations

Maintained by [@jeffallan](https://github.com/jeffallan), Principal Consultant at [Synergetic Solutions](https://synergetic.solutions)

[Documentation](https://jeffallan.github.io/claude-skills/skills/quality/test-master/)
