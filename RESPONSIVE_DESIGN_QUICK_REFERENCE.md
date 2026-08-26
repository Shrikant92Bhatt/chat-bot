# Responsive Design Quick Reference

## Common Responsive Patterns

### Touch-Friendly Buttons
```html
<!-- Ensures 44x44px minimum on all devices -->
<button class="p-2 touch-target rounded-lg hover:bg-white/5">
  Click me
</button>
```

### Responsive Padding
```html
<!-- Scales: small phone (px-2) → tablet (px-4) → desktop (px-6) -->
<div class="responsive-px py-2 sm:py-3 md:py-4">
  Content
</div>

<!-- Or use directly -->
<div class="px-2 sm:px-3 md:px-4 lg:px-6">
  Content
</div>
```

### Safe Area Support (Notched Devices)
```html
<!-- Automatically accounts for iPhone notch/home indicator -->
<div class="safe-area-inset p-4">
  Content in safe area
</div>

<!-- Or apply individually -->
<div class="pb-[calc(1rem+env(safe-area-inset-bottom))]">
  Respects home indicator
</div>
```

### Responsive Sizing
```html
<!-- Images that scale -->
<img src="..." class="image-responsive" alt="..." />

<!-- Text that scales by breakpoint -->
<p class="text-sm sm:text-base md:text-lg">
  Responsive text
</p>

<!-- Font prevents auto-zoom on mobile -->
<textarea class="prevent-auto-zoom" placeholder="Type..."></textarea>
```

### Responsive Layout
```html
<!-- Stacks on mobile, row on larger screens -->
<div class="flex-responsive gap-responsive">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<!-- Translates to: flex flex-col sm:flex-row gap-2 sm:gap-3 -->
```

### Cards with Responsive Padding
```html
<!-- Scales: px-3 sm:px-4 md:px-5 -->
<div class="card-responsive">
  Card content
</div>
```

### Responsive Grid
```html
<!-- Auto-responsive grid: 1 column on mobile, auto-fit on larger -->
<div class="grid-responsive-auto">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

## Breakpoint Reference

```css
/* Default (mobile-first) - 0px and up */
.px-2

/* Small: 640px and up */
@media (min-width: 640px) { }
.sm:px-3

/* Medium: 768px and up */
@media (min-width: 768px) { }
.md:px-4

/* Large: 1024px and up */
@media (min-width: 1024px) { }
.lg:px-6

/* XL: 1280px and up */
@media (min-width: 1280px) { }
.xl:px-8
```

## Tailwind Responsive Prefixes

| Prefix | Breakpoint | Screen Size |
|--------|-----------|------------|
| (none) | Default | Mobile-first |
| `sm:` | Small | 640px+ |
| `md:` | Medium | 768px+ |
| `lg:` | Large | 1024px+ |
| `xl:` | Extra Large | 1280px+ |

## Design Tokens (CSS Custom Properties)

### Colors
```css
var(--color-bg-primary)        /* #0a0d14 */
var(--color-bg-secondary)      /* #0f172a */
var(--color-surface-primary)   /* #1a1f2e */
var(--color-surface-secondary) /* #242b37 */
var(--color-surface-hover)     /* #2d3748 */
var(--color-surface-active)    /* #374151 */

var(--color-text-primary)      /* #f1f5f9 */
var(--color-text-secondary)    /* #cbd5e1 */
var(--color-text-tertiary)     /* #94a3b8 */
var(--color-text-muted)        /* #64748b */

var(--color-border-light)      /* rgba(255,255,255,0.08) */
var(--color-border-medium)     /* rgba(255,255,255,0.12) */

var(--color-accent-primary)    /* #06b6d4 */
var(--color-accent-secondary)  /* #8b5cf6 */
var(--color-accent-success)    /* #10b981 */
var(--color-accent-warning)    /* #f59e0b */
var(--color-accent-danger)     /* #f43f5e */
```

### Spacing
```css
var(--space-xs)   /* 4px */
var(--space-sm)   /* 8px */
var(--space-md)   /* 12px */
var(--space-lg)   /* 16px */
var(--space-xl)   /* 24px */
var(--space-2xl)  /* 32px */
var(--space-3xl)  /* 48px */
```

### Use in CSS
```css
.my-component {
  background: var(--color-bg-primary);
  padding: var(--space-lg);
  border: 1px solid var(--color-border-light);
  color: var(--color-text-primary);
}
```

### Use in HTML
```html
<div style="background: var(--color-bg-primary); padding: var(--space-lg);">
  Content
</div>
```

## Mobile-First Development Checklist

When building new components:

- [ ] Default styles are mobile-optimized
- [ ] Touch targets minimum 44x44px
- [ ] Base font size 16px (prevents zoom)
- [ ] Responsive padding applied
- [ ] Images use `class="image-responsive"`
- [ ] Use design tokens for colors
- [ ] Text wrapping with `break-words`
- [ ] No fixed widths (use max-width instead)
- [ ] Tested on small phone (320px)
- [ ] Tested on tablet (768px)
- [ ] Tested on desktop (1280px)

## Common Patterns

### Responsive Navigation Bar
```html
<header class="h-14 sm:h-16 px-2 sm:px-3 md:px-6 flex items-center">
  <button class="touch-target p-2 rounded-lg hover:bg-white/5">
    Menu
  </button>
  <div class="hidden sm:block text-lg font-semibold">
    Logo
  </div>
</header>
```

### Message Input with Safe Area
```html
<div class="px-2 sm:px-3 md:px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
  <form class="flex gap-2">
    <textarea class="flex-1 prevent-auto-zoom text-base sm:text-sm"></textarea>
    <button class="touch-target p-2 rounded-lg bg-white">
      Send
    </button>
  </form>
</div>
```

### Responsive Card
```html
<div class="card-responsive flex flex-col gap-2">
  <h3 class="text-sm sm:text-base font-semibold">Title</h3>
  <p class="text-xs sm:text-sm text-slate-400">Content</p>
</div>
```

### Responsive Grid
```html
<div class="grid-responsive-auto gap-responsive">
  <div class="card-responsive">Item 1</div>
  <div class="card-responsive">Item 2</div>
  <div class="card-responsive">Item 3</div>
</div>
```

### Responsive Message
```html
<div class="max-w-xs sm:max-w-lg md:max-w-2xl px-3 sm:px-4 py-2 sm:py-3 rounded-2xl bg-indigo-500/15">
  {{ message.content }}
</div>
```

### Responsive Image Gallery
```html
<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
  <img *ngFor="let img of images" [src]="img" class="image-responsive rounded-lg" />
</div>
```

## Responsive Typography

### Text Sizing
```html
<!-- Scales with viewport -->
<h1 class="text-lg sm:text-xl md:text-2xl font-bold">Heading</h1>
<p class="text-sm sm:text-base md:text-lg">Body text</p>

<!-- Use responsive utilities -->
<p class="text-responsive-base">Scales: base → lg</p>
<p class="text-responsive-lg">Scales: lg → xl</p>
```

### Line Height
```html
<!-- Always use adequate line-height for readability -->
<p class="leading-relaxed text-sm sm:text-base">
  Long paragraph with good readability on mobile
</p>
```

## Avoiding Common Pitfalls

### ❌ Fixed Widths (Don't)
```html
<!-- BAD: Only works on desktop -->
<div class="w-600">Content</div>
```

### ✅ Flexible Widths (Do)
```html
<!-- GOOD: Responsive to viewport -->
<div class="max-w-3xl mx-auto px-2 sm:px-4">Content</div>
```

### ❌ Horizontal Scrolling (Don't)
```html
<!-- BAD: Allows page-level scroll -->
<div class="w-[1200px] overflow-x-auto">
```

### ✅ Contained Scrolling (Do)
```html
<!-- GOOD: Scroll only within element -->
<div class="overflow-x-auto max-w-full">
```

### ❌ Small Touch Targets (Don't)
```html
<!-- BAD: 24px - too small -->
<button class="p-1 text-xs">Small</button>
```

### ✅ Proper Touch Targets (Do)
```html
<!-- GOOD: 44px minimum -->
<button class="p-2 touch-target">Tap me</button>
```

### ❌ Hover Dependencies (Don't)
```html
<!-- BAD: Hidden on mobile touch devices -->
<div class="opacity-0 group-hover:opacity-100">
  Only visible on hover
</div>
```

### ✅ Touch-Accessible (Do)
```html
<!-- GOOD: Always visible, hover refinement -->
<div class="opacity-100 md:opacity-0 md:group-hover:opacity-100">
  Always visible on mobile, hover on desktop
</div>
```

## Testing Responsive Design

### Quick DevTools Test
```javascript
// Check viewport width
console.log('Viewport:', window.innerWidth);

// Verify no horizontal scroll
console.log('No h-scroll:', window.innerWidth === document.documentElement.clientWidth);

// Check textarea font size
const textarea = document.querySelector('textarea');
console.log('Font size:', window.getComputedStyle(textarea).fontSize);
```

### Device Simulation
```
Chrome DevTools > Toggle Device Toolbar > Select Device
or
Ctrl+Shift+M (toggle device mode)
```

## Best Practices

1. **Mobile-First**: Write default styles for mobile, enhance with breakpoints
2. **Touch-Friendly**: 44x44px minimum for all interactive elements
3. **Readable Text**: 16px minimum font size on mobile
4. **Safe Areas**: Use `env()` for notched devices
5. **Flexible Layouts**: Use flexbox/grid, avoid fixed widths
6. **Responsive Images**: `max-width: 100%` with proper aspect ratio
7. **Contained Scrolling**: No page-level horizontal scroll
8. **Design Tokens**: Use CSS custom properties for consistency
9. **Test Often**: Verify at multiple breakpoints
10. **Performance**: Minimize CSS, use efficient selectors

## Resources

- **Full Documentation**: See MOBILE_RESPONSIVE_OPTIMIZATION.md
- **Testing Guide**: See MOBILE_TESTING_GUIDE.md
- **Tailwind Docs**: https://tailwindcss.com/docs/responsive-design
- **CSS Safe Areas**: https://www.webkit.org/blog/7929/designing-websites-for-iphone-x/

---

**Last Updated**: August 26, 2026
**Version**: 1.0
**Status**: Production Ready
