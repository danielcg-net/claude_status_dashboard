---
name: playwright-best-practices
description: Playwright best practices including selectors, wait strategies, accessibility testing, responsive design, and flaky-test prevention. Use when writing or improving Playwright E2E tests.
---

# Playwright Best Practices

Expert guidance for writing reliable, maintainable Playwright tests.

## Quick Reference

| Concern | Best Practice | Avoid |
|---------|---------------|-------|
| Selectors | getByRole, getByTestId, getByLabel | CSS classes, DOM structure |
| Waits | Auto-waiting, explicit assertions | waitForTimeout, hardcoded delays |
| Accessibility | getByRole, a11y checks | Visual-only testing |
| Flaky tests | Proper waits, stable selectors | Timing-dependent assertions |
| Isolation | Cleanup after each test | Tests depending on each other |
| Parallel | Independent tests | Shared state |

## Essential Principles

**Use semantic selectors**: getByRole, getByLabel, getByTestId are stable. CSS classes and DOM structure change frequently.

**Never waitForTimeout**: Hardcoded delays make tests slow and flaky. Use auto-waiting and explicit assertions.

**Test accessibility**: getByRole ensures accessible markup. Keyboard tests verify a11y.

**Isolate tests**: Each test should work independently. Clean up test data after each test.

**Responsive testing**: Test mobile, tablet, desktop viewports.

## Selector Best Practices

```typescript
// ❌ Bad: Fragile selectors
page.click('div > div > button')
page.click('.btn-primary')
page.click('#submit-btn-123')

// ✅ Good: Stable, semantic selectors
page.getByRole('button', { name: 'Submit' })
page.getByTestId('submit-button')
page.getByLabel('Email address')
```

## Wait Strategies

```typescript
// ❌ Bad: Hardcoded waits
page.waitForTimeout(5000)  // Flaky, slow

// ✅ Good: Explicit waits
await page.waitForURL('/dashboard')
await page.waitForSelector('[data-testid="success-message"]')
await expect(page.getByTestId('loading')).toBeHidden()
await page.waitForResponse(resp => resp.url().includes('/api/users') && resp.status() === 200)
```

## Accessibility Testing

```typescript
// Good: Semantic selectors enforce a11y
await page.getByRole('button', { name: 'Submit' }).click()

// Good: Keyboard navigation test
test('is keyboard navigable', async ({ page }) => {
  await page.goto('/form')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('name-input')).toBeFocused()
})

// Good: A11y assertions (with axe-core)
await expect(page).toHaveAccessibleTree()
```

## Responsive Testing

```typescript
test.describe('Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('shows mobile menu', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('hamburger-menu')).toBeVisible()
  })
})
```

## Common Anti-Patterns

| Anti-Pattern | Severity | Fix |
|--------------|----------|-----|
| waitForTimeout | Critical | Use explicit waits/assertions |
| CSS class selectors | High | Use getByRole/getByTestId |
| Tests depending on each other | High | Make tests independent |
| No cleanup | Medium | Use fixtures with proper cleanup |
| Only desktop testing | Low | Test multiple viewports |
| Hardcoded test data | Medium | Use data factories |

## Success Criteria

Tests are reliable when:
- No waitForTimeout in tests
- Selectors are semantic (getByRole, getByTestId)
- Tests run in isolation (independent)
- Test data cleaned up after each test
- Multiple viewports tested
- Accessibility assertions present
- Tests are deterministic (no randomness)
