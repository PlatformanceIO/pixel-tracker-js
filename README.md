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

Simply add the following code to your HTML file, ideally right before the closing `</body>` tag:

```html
<script src="https://pixel.data.platformance.io/tracker.js"></script>
<script>
    var pfTracker = new PlatformanceTracker('SITE_ID');
    // custom events can be sent like this:
    // pfTracker.trackEvent('custom_event', {
    //     custom_property: 'value'
    // });
</script>
```

That's it! The tracker will automatically start collecting data. For advanced configuration, you can initialize it with additional options:cker JS SDK

### ⚙️ Advanced Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `apiBase` | API endpoint URL | `'https://events.data.platformance.io'` |
| `debug` | Enable verbose logging | `false` |
| `maxRetries` | Max retry attempts | `3` |
| `retryTimeout` | Retry delay (ms) | `1000` |
| `batchSize` | Events per batch | `10` |
| `batchTimeout` | Batch delay (ms) | `1000` |

### 📡 Built-in Events

The tracker automatically captures the following events:

- `session_start`: When the page loads
- `impression`: Initial page view
- `viewable_impression`: When the page becomes visible
- `engagement`: User interactions (debounced)
- `click`: Any click on the page with element details
- `exit`: Clicks on external links
- `close`: Page visibility changes
- `session_end`: Before page unload

### Tracking Custom Events

You can track custom events with additional data:

```javascript
tracker.trackEvent('custom_event_name', {
    custom_property: 'value'
});
```

Note: Custom event names will automatically be prefixed with 'custom_' if not already present.

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
