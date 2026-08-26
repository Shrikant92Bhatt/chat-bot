# Mobile Responsive Design Testing Guide

## Quick Testing Checklist

### Browser DevTools Testing (Chrome/Edge/Firefox)

#### 1. Small Phone (320px)
```
DevTools > Toggle device toolbar > iPhone SE
Viewport: 375px × 667px (display width: 320px)
```

**Checklist:**
- [ ] No horizontal scrolling on any page
- [ ] Hamburger menu visible (sidebar collapsed)
- [ ] Message input fits without overflow
- [ ] Send button accessible and tappable
- [ ] Text readable (minimum 14px effective)
- [ ] Images scale to fit viewport
- [ ] Buttons have minimum 44px height/width
- [ ] Modal dialogs fit viewport
- [ ] Tables scroll horizontally only (not page)
- [ ] Code blocks scroll horizontally only

#### 2. Standard Phone (360px - 390px)
```
DevTools > iPhone 12/13
Viewport: 390px × 844px
```

**Checklist:**
- [ ] All items from 320px test pass
- [ ] Slightly more breathing room in UI
- [ ] Navbar properly spaced
- [ ] Weather card displays forecast preview
- [ ] Stock chart visible and readable
- [ ] Long messages display properly with wrapping

#### 3. Large Phone (430px)
```
DevTools > iPhone 14 Pro Max
Viewport: 430px × 932px
```

**Checklist:**
- [ ] All mobile optimizations still applied
- [ ] Extra padding used appropriately
- [ ] Cards display in single column
- [ ] Comfortable spacing between elements

#### 4. Landscape Phone (640px width, 360px height)
```
DevTools > Toggle device toolbar > Landscape
```

**Checklist:**
- [ ] No horizontal scrolling
- [ ] Sidebar appropriately sized
- [ ] Chat window has adequate height
- [ ] Message input remains accessible
- [ ] No UI elements hidden unnecessarily
- [ ] Keyboard consideration (may cover 50% of screen)

#### 5. Tablet (768px)
```
DevTools > iPad Mini
Viewport: 768px × 1024px
```

**Checklist:**
- [ ] Sidebar visible (not collapsed)
- [ ] Chat window uses appropriate width (max ~600px)
- [ ] Sidebar + chat layout balanced
- [ ] All components properly sized
- [ ] Touch targets still 44px minimum
- [ ] No excessive white space

#### 6. Large Tablet (1024px)
```
DevTools > iPad Pro
Viewport: 1024px × 1366px
```

**Checklist:**
- [ ] Desktop-like layout with sidebar
- [ ] Full-width utilization appropriate
- [ ] Charts display with good detail
- [ ] Tables show multiple columns
- [ ] Weather card shows hourly forecast

#### 7. Desktop (1280px+)
```
DevTools > Standard desktop (1920x1080)
```

**Checklist:**
- [ ] Full layout optimized
- [ ] Maximum width constraints applied
- [ ] Hover states work (buttons, links)
- [ ] Modals centered appropriately
- [ ] No awkward spacing issues

### Physical Device Testing

#### iOS Testing
```
Devices: iPhone SE, iPhone 12/13, iPhone 14 Pro Max, iPad
```

**Keyboard Testing:**
- [ ] Keyboard appears when tapping input
- [ ] Message input stays accessible above keyboard
- [ ] Scroll to message input when keyboard appears
- [ ] No auto-zoom when typing (font size 16px)
- [ ] Dismissing keyboard restores view

**Notch/Safe Area Testing (iPhone X+):**
- [ ] Bottom padding for home indicator
- [ ] Top padding respects notch
- [ ] Navbar extends to notch properly
- [ ] Message input respects bottom safe area

**Gesture Testing:**
- [ ] Swipe back for navigation works
- [ ] Pull-down refresh doesn't interfere
- [ ] Long press on links works
- [ ] Tap targets are accurate (no "fat finger" errors)

#### Android Testing
```
Devices: Samsung Galaxy S20/S21, Google Pixel
```

**Keyboard Testing:**
- [ ] Android keyboard appears smoothly
- [ ] Message input stays accessible
- [ ] No zoom on input focus (16px font)
- [ ] Back button dismisses keyboard

**Edge Case Testing:**
- [ ] Landscape orientation smooth
- [ ] System UI insets handled
- [ ] Vibration feedback (if enabled)

### Network Testing

#### Slow 3G
```
DevTools > Network > Slow 3G (400kb/s down, 400kb/s up)
```

**Checklist:**
- [ ] Page loads within reasonable time
- [ ] Content loads progressively
- [ ] Images lazy-load appropriately
- [ ] No timeout errors
- [ ] Message sending works reliably

#### 4G LTE
```
DevTools > Network > Fast 3G
```

**Checklist:**
- [ ] Smooth loading
- [ ] Responsive interactions
- [ ] File uploads complete successfully

### Input Testing

#### Text Input
- [ ] Typing in message input works smoothly
- [ ] Cursor visible and accessible
- [ ] Backspace/delete works
- [ ] Line breaks work (Shift+Enter)
- [ ] Send on Enter works
- [ ] Auto-grow textarea functions
- [ ] Long messages don't break layout

#### File Upload
- [ ] File picker opens on button click
- [ ] Multiple files selectable
- [ ] Thumbnail previews display
- [ ] Removal button works
- [ ] Upload progress shows
- [ ] Error handling displays clearly

#### Voice/Dictation
- [ ] Voice button appears (if supported)
- [ ] Microphone access requested properly
- [ ] Recording indicator shows
- [ ] Stop button functional
- [ ] Text inserted correctly

### Message Display Testing

#### Message Bubbles
- [ ] User messages align right
- [ ] Assistant messages align left
- [ ] Avatars display properly
- [ ] Timestamps visible (if shown)
- [ ] Message actions (copy, edit) accessible
- [ ] Overflow handled gracefully

#### Attachments
- [ ] Image previews display at correct size
- [ ] Video controls work
- [ ] Aspect ratios maintained
- [ ] Click to zoom works
- [ ] Download works (if applicable)

#### Code Blocks
- [ ] Syntax highlighting visible
- [ ] Horizontal scroll works (not page)
- [ ] Copy button functional
- [ ] Line numbers toggle works (if enabled)
- [ ] Text is selectable
- [ ] Font readable at small sizes

#### Tables
- [ ] Headers stay sticky while scrolling
- [ ] Data readable at small sizes
- [ ] Horizontal scroll works smoothly
- [ ] Export CSV button works
- [ ] Pagination (if used) works

#### Weather/Stock Cards
- [ ] Weather icon displays
- [ ] Temperature readable
- [ ] Forecast items scroll (if needed)
- [ ] Stock chart visible and usable
- [ ] Price info clearly displayed

### Navigation Testing

#### Sidebar
- [ ] Toggle button works
- [ ] Sidebar slides smoothly
- [ ] Overlay dismisses sidebar
- [ ] Search works
- [ ] Thread selection works
- [ ] New chat button functional

#### Navbar
- [ ] Home/logo clickable
- [ ] Settings button opens modal
- [ ] Admin button visible (if admin)
- [ ] Share button works
- [ ] Profile menu opens/closes
- [ ] Sign out works

#### Modals
- [ ] Modal opens and centers
- [ ] Close button works
- [ ] Content fits viewport
- [ ] Scrollable if needed
- [ ] No content hidden
- [ ] Backdrop dismisses modal

### Responsive Styling Verification

#### CSS Media Queries
Open DevTools Console and run:
```javascript
// Check if styles apply at breakpoints
const styles = window.getComputedStyle(document.querySelector('.message-input-container'));
console.log('Current padding:', styles.paddingLeft);
console.log('Current height (navbar):', window.getComputedStyle(document.querySelector('header')).height);

// Verify responsive classes exist
const html = document.documentElement.outerHTML;
console.log('Has responsive classes:', html.includes('sm:') || html.includes('md:') || html.includes('lg:'));
```

#### Font Sizing
```javascript
// Verify input font size (should be 16px to prevent zoom)
const textarea = document.querySelector('textarea');
console.log('Textarea font size:', window.getComputedStyle(textarea).fontSize);

// Should be >= 16px on mobile
```

#### Safe Area Support
```javascript
// Check if safe area CSS is applied
console.log('Safe area left:', getComputedStyle(document.documentElement).getPropertyValue('--safe-area-left'));
```

### Performance Testing

#### Lighthouse Audit
```
DevTools > Lighthouse > Mobile
```

**Targets:**
- [ ] Performance: 90+
- [ ] Accessibility: 90+
- [ ] Best Practices: 90+
- [ ] SEO: 90+

**Specific Metrics:**
- [ ] Cumulative Layout Shift: < 0.1
- [ ] First Contentful Paint: < 1.8s
- [ ] Largest Contentful Paint: < 2.5s

#### Web Vitals
```
DevTools > Web Vitals
```

**Checklist:**
- [ ] LCP (Largest Contentful Paint) good
- [ ] FID (First Input Delay) responsive
- [ ] CLS (Cumulative Layout Shift) stable

### Accessibility Testing

#### Keyboard Navigation
- [ ] Tab order logical
- [ ] Focus indicators visible
- [ ] Can reach all controls via keyboard
- [ ] No keyboard traps
- [ ] Enter/Space activate buttons properly

#### Screen Reader (VoiceOver/TalkBack)
- [ ] Page structure announced correctly
- [ ] Buttons have accessible labels
- [ ] Form inputs labeled
- [ ] Images have alt text
- [ ] Dynamic content announced

#### Color Contrast
```
DevTools > Lighthouse > Accessibility
```

**Checklist:**
- [ ] Text contrast ratio >= 4.5:1
- [ ] Large text >= 3:1
- [ ] No color-only information

### Issue Reporting Template

If you find a responsive issue:

```
## Device Information
- Device: [iPhone 12 / Samsung Galaxy S21 / etc]
- Screen Size: [390px / 412px / etc]
- Orientation: [Portrait / Landscape]
- OS Version: [iOS 15.2 / Android 12 / etc]
- Browser: [Safari / Chrome / etc]
- Network: [WiFi / 4G / etc]

## Issue Description
- What went wrong?
- Where does it occur?
- Screenshots/video attached?

## Steps to Reproduce
1. Open app
2. Navigate to...
3. Observe...

## Expected Behavior
- What should happen?

## Actual Behavior
- What actually happens?

## CSS Classes/Elements Affected
- Any specific Tailwind classes or elements involved?
```

## Automated Testing Script

Run this in browser console:

```javascript
// Mobile Responsive Design Test Suite
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Test 1: No horizontal scrolling
function testNoHorizontalScroll() {
  if (window.innerWidth === document.documentElement.clientWidth) {
    testResults.passed.push('No horizontal scroll detected');
  } else {
    testResults.failed.push('Horizontal scroll detected (page width: ' + document.documentElement.scrollWidth + 'px)');
  }
}

// Test 2: Touch target sizes
function testTouchTargets() {
  const buttons = document.querySelectorAll('button');
  let smallButtons = [];
  buttons.forEach(btn => {
    const rect = btn.getBoundingClientRect();
    if (rect.height < 44 || rect.width < 44) {
      smallButtons.push(btn);
    }
  });
  if (smallButtons.length === 0) {
    testResults.passed.push('All buttons meet touch target size (44px+)');
  } else {
    testResults.warnings.push(smallButtons.length + ' buttons are smaller than 44px');
  }
}

// Test 3: Font sizes
function testFontSizes() {
  const body = window.getComputedStyle(document.body);
  const fontSize = parseInt(body.fontSize);
  if (fontSize >= 14) {
    testResults.passed.push('Body font size appropriate: ' + fontSize + 'px');
  } else {
    testResults.failed.push('Body font size too small: ' + fontSize + 'px');
  }
}

// Test 4: Textarea font size (prevent zoom)
function testTextareaZoomPrevention() {
  const textarea = document.querySelector('textarea');
  if (textarea) {
    const fontSize = parseInt(window.getComputedStyle(textarea).fontSize);
    if (fontSize >= 16) {
      testResults.passed.push('Textarea font size prevents zoom: ' + fontSize + 'px');
    } else {
      testResults.failed.push('Textarea font size may trigger zoom: ' + fontSize + 'px');
    }
  }
}

// Test 5: Overflow on children
function testOverflow() {
  const main = document.querySelector('main');
  if (main && main.scrollWidth <= main.clientWidth) {
    testResults.passed.push('Main content fits viewport width');
  } else if (main) {
    testResults.failed.push('Main content exceeds viewport: ' + main.scrollWidth + 'px > ' + main.clientWidth + 'px');
  }
}

// Run tests
testNoHorizontalScroll();
testTouchTargets();
testFontSizes();
testTextareaZoomPrevention();
testOverflow();

// Report results
console.log('=== Mobile Responsive Tests ===');
console.log('✅ Passed (' + testResults.passed.length + '):');
testResults.passed.forEach(t => console.log('  • ' + t));
console.log('❌ Failed (' + testResults.failed.length + '):');
testResults.failed.forEach(t => console.log('  • ' + t));
console.log('⚠️ Warnings (' + testResults.warnings.length + '):');
testResults.warnings.forEach(t => console.log('  • ' + t));
```

## Test Environment Setup

### Chrome DevTools
1. Open DevTools (F12)
2. Click device toolbar (Ctrl+Shift+M)
3. Select device from dropdown
4. Rotate device (Ctrl+Shift+M then rotate)

### Firefox Responsive Design Mode
1. Press Ctrl+Shift+M
2. Click "Responsive Design Mode" menu
3. Select device or enter custom dimensions

### Safari
1. Develop > Enter Responsive Design Mode (Cmd+R)
2. Select device from dropdown

## Continuous Testing

- Run tests after each UI change
- Test on multiple screen sizes
- Verify keyboard handling
- Check image/video loading
- Test file uploads
- Verify error messages display properly
- Test long-running operations (streaming, uploads)

## Sign-Off Checklist

Before marking responsive design complete:

- [ ] All breakpoints tested (320px, 360px, 390px, 430px, 768px, 1024px, 1280px+)
- [ ] All devices tested (iPhone, Android, iPad)
- [ ] Landscape orientation works
- [ ] Keyboard handling verified
- [ ] Touch targets all minimum 44px
- [ ] No horizontal scrolling
- [ ] Images responsive
- [ ] Tables scroll contained
- [ ] Code blocks scroll contained
- [ ] Charts display correctly
- [ ] Weather/Stock cards responsive
- [ ] Modals fit viewport
- [ ] Performance acceptable (Lighthouse 90+)
- [ ] Accessibility passing (WCAG 2.1 AA)
- [ ] No console errors
- [ ] Network requests optimized

---

**Last Updated**: August 26, 2026
**Test Coverage**: Mobile-first responsive design across all target breakpoints
