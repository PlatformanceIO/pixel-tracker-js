# 🚀 PF Pixel Tracker JS SDK

<p align="center">
  <img src="platformance-logo.png" alt="Platformance Logo" width="200"/>
</p>

🔍 A high-performance, zero-dependency JavaScript pixel tracker engineered for precise user behavior analytics. Built with modern web standards and optimized for enterprise-scale deployments.

## ✨ Key Features

🔄 **Real-time Event Tracking**
  - 📊 Session lifecycle management (start/end)
  - 👁️ Smart impression tracking (viewable/non-viewable)
  - 🖱️ Rich interaction analytics (mouse, scroll, keyboard)
  - 🎯 Detailed click tracking with DOM context
  - 🔗 Exit intent detection
  - 🚪 Visibility state monitoring

🛡️ **Enterprise-Ready Architecture**
  - 📦 Efficient batch processing with smart queuing
  - 🔄 Automatic retry mechanism with exponential backoff
  - 🌐 Cross-browser support (IE11+)
  - 📱 Responsive design analytics
  - 📈 Comprehensive scroll depth metrics
  - 🎨 Extensible custom event system


## 🚀 Quick Start Configuration

### Auto-Initialization (Recommended)

The simplest way to add the tracker is with a single script tag that automatically initializes:

```html
<script data-siteid="YOUR_SITE_ID" src="https://pixel.data.platformance.io/tracker.min.js"></script>
```

That's it! The tracker will automatically:
- ✅ Initialize with your site ID
- ✅ Start tracking immediately
- ✅ Tracker available as `window.pfTracker`
- ✅ Queue available as `window.pfQueue`
- ✅ Begin collecting session and interaction data

**Sending Custom Events:**
```html
<script>

  window.pfQueue = window.pfQueue || [];

  window.pfQueue.push(['track', 'custom_signup', {
    user_type: 'premium',
    source: 'homepage'
  }]);

</script>
```

### ⚙️ Advanced Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `apiBase` | API endpoint URL | `'https://events.data.platformance.io'` |
| `debug` | Enable verbose logging | `false` |
| `maxRetries` | Max retry attempts | `3` |
| `retryTimeout` | Retry delay (ms) | `1000` |
| `batchSize` | Events per batch | `10` |
| `batchTimeout` | Batch delay (ms) | `1000` |

### 📡 Automatically Fired Events

The tracker automatically captures the following events without any additional configuration:

#### 🚀 **`session_start`**
- **When fired**: Immediately when the tracker is initialized
- **Purpose**: Marks the beginning of a user session
- **Data included**: Full browser info, scroll position, viewport details

#### 👁️ **`impression`**
- **When fired**: 
  - Immediately when the tracker is initialized
  - When the page gains focus (window focus event)
- **Purpose**: Tracks page views and visibility
- **Data included**: Complete browser context, scroll metrics, timestamp

#### 🖱️ **`click`**
- **When fired**: On any click event anywhere on the page
- **Purpose**: Captures user interactions with detailed element context
- **Additional data captured**:
  - `browser_element_tag`: HTML tag name of clicked element
  - `browser_element_id`: Element ID attribute
  - `browser_element_class`: Element class names
  - `browser_element_text`: Element text content (first 100 characters)

#### 🔗 **`exit`**
- **When fired**: When user clicks on external links (different hostname)
- **Purpose**: Tracks exit intent and external navigation
- **Trigger condition**: Link clicks where `link.hostname !== window.location.hostname`

#### 🚪 **`close`**
- **When fired**: When the page becomes hidden (visibility API)
- **Purpose**: Tracks when users switch tabs or minimize the browser
- **Browser support**: Uses `visibilitychange` event when `document.hidden` becomes true

#### 🏁 **`session_end`**
- **When fired**: Before the page unloads (`beforeunload` event)
- **Purpose**: Marks the end of a user session
- **Note**: Attempts to process any remaining queued events before page exit

### Tracking Custom Events

There are two ways to track custom events with the Platformance tracker:

#### Array-Based Approach (Before Tracker Loads)

If you need to track events before the tracker script is fully loaded, you can initialize a global array and push events to it:

```javascript
// Initialize the queue array before the tracker script loads
window.pfQueue = window.pfQueue || [];

// Push custom events to the array
window.pfQueue.push(['track', 'custom_conversion', {
    value: 100,
    currency: 'USD',
    product_id: 'ABC123'
}]);

window.pfQueue.push(['track', 'custom_signup', {
    user_type: 'premium',
    source: 'homepage'
}]);
```

The array command format is: `['track', 'event_name', {additional_data}]`

**Alternative:** You can also use `'trackEvent'` as the action: `['trackEvent', 'event_name', {additional_data}]`


**Note:** Custom event names will automatically be prefixed with 'custom_' if not already present.

### 📊 Rich Event Data

```typescript
interface EventData {
  timestamp: ISO8601String;
  browser: {
    screen: {
      width: number;
      height: number;
      ratio: number;
    };
    viewport: {
      width: number;
      height: number;
      pageHeight: number;
    };
    platform: string;
    language: string;
    cores: number;
    connection: NetworkInformation;
    cookiesEnabled: boolean;
    referrer: string;
  };
  scroll: {
    percentage: number;
    position: number;
    totalHeight: number;
  };
  sessionId: UUID;
  customData?: Record<string, any>;
}
```

## 🌐 Browser Support

The tracker includes polyfills for:
- Promises
- Object.assign

This ensures compatibility with older browsers while maintaining modern functionality.

| Feature | Chrome | Firefox | Safari | Edge | IE11 |
|---------|---------|----------|---------|------|------|
| Core Functionality | ✅ | ✅ | ✅ | ✅ | ✅ |
| Performance API | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Network Info | ✅ | ✅ | ⚠️ | ✅ | ❌ |

## 🔧 Error Handling

Engineered for reliability with:
- 🔄 Smart retry logic with exponential backoff
- 📦 Efficient batch processing
- 🔍 Comprehensive debug logging
- 💾 Failed event persistence
- ⚡ Queue optimization

## 📈 Performance

- 🗜️ < 5KB gzipped
- ⚡ Zero dependencies
- 🔄 Async by default
- 🗃️ Batch processing
- 📦 Tree-shakeable

---
<div align="center">
Made with ❤️ by the Platformance Team
</div>
