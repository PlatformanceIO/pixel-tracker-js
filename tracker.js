; (function (window) {
    // Initialize global queue if it doesn't exist
    window.pfQueue = window.pfQueue || [];
    window.platformanceQueue = window.platformanceQueue || [];

    // Event type definitions
    var EVENT_TYPES = {
        SESSION_START: 'session_start',
        IMPRESSION: 'impression',
        CLICK: 'click',
        EXIT: 'exit',
        CLOSE: 'close',
        SESSION_END: 'session_end'
    };

    // Polyfills for older browsers
    if (!window.Promise) {
        window.Promise = function (executor) {
            var callback = null;
            var value = null;
            var settled = false;

            this.then = function (cb) {
                callback = cb;
                if (settled) {
                    callback(value);
                }
                return this;
            };

            function resolve(val) {
                value = val;
                settled = true;
                if (callback) {
                    callback(value);
                }
            }

            executor(resolve);
        };
    }

    // Polyfill for Object.assign
    if (typeof Object.assign !== 'function') {
        Object.assign = function (target) {
            if (target == null) {
                throw new TypeError('Cannot convert undefined or null to object');
            }
            target = Object(target);
            for (var index = 1; index < arguments.length; index++) {
                var source = arguments[index];
                if (source != null) {
                    for (var key in source) {
                        if (Object.prototype.hasOwnProperty.call(source, key)) {
                            target[key] = source[key];
                        }
                    }
                }
            }
            return target;
        };
    }

    var PlatformanceTracker = function (siteId, options) {
        if (!siteId) {
            throw new Error('siteId is required');
        }

        this.siteId = siteId;
        this.options = options || {};
        this.apiBase = this.options.apiBase || 'https://events.data.platformance.io';
        this.sessionId = this.generateSessionId();
        this.userId = null; // Will be set after fingerprint is ready
        this.lastScrollPosition = 0;
        this.lastScrollTime = this.now();
        this.queue = [];
        this.maxRetries = this.options.maxRetries || 3;
        this.retryTimeout = this.options.retryTimeout || 1000;
        this.batchSize = this.options.batchSize || 10;
        this.batchTimeout = this.options.batchTimeout || 1000;
        this.debug = this.options.debug || false;
        this.isInitialized = false;

        // Initialize the tracker after getting the user ID
        this.initialize();
    };

    PlatformanceTracker.prototype.now = function () {
        return Date.now ? Date.now() : new Date().getTime();
    };

    PlatformanceTracker.prototype.log = function () {
        if (this.debug && window.console && window.console.log) {
            console.log.apply(console, arguments);
        }
    };

    PlatformanceTracker.prototype.initialize = function () {
        var self = this;

        self.log('Initializing PlatformanceTracker, waiting for user ID...');

        // Generate user ID first (this returns a Promise)
        this.generateUserId()
            .then(function (userId) {
                self.userId = userId;
                self.isInitialized = true;
                self.log('PlatformanceTracker initialized with user ID:', userId);

                // Now start processing everything
                self.processGlobalQueue();

                // Process any pending events that were queued before initialization
                if (self.pendingEvents && self.pendingEvents.length > 0) {
                    self.log('Processing pending events:', self.pendingEvents.length);
                    for (var i = 0; i < self.pendingEvents.length; i++) {
                        var pendingEvent = self.pendingEvents[i];
                        var action = pendingEvent[0];
                        var eventType = pendingEvent[1];
                        var additionalData = pendingEvent[2];

                        if (action === 'track' || action === 'trackEvent') {
                            self.trackEvent(eventType, additionalData);
                        }
                    }
                    self.pendingEvents = [];
                }

                self.processBatchedEvents();
                self.initializeEventListeners();

                // Track initial events
                self.trackEvent(EVENT_TYPES.SESSION_START);
                setTimeout(function () {
                    self.trackEvent(EVENT_TYPES.IMPRESSION);
                }, 1500);
            })
            .catch(function (error) {
                self.log('Failed to initialize PlatformanceTracker:', error);
                // Don't initialize if we can't get the fingerprint
            });
    };

    PlatformanceTracker.prototype.generateSessionId = function () {
        var d = this.now();
        var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        return uuid;
    };

    PlatformanceTracker.prototype.generateUserId = function () {
        var self = this;
        var storedUserId = localStorage.getItem('platformance_user_id');
        if (storedUserId) {
            return Promise.resolve(storedUserId);
        }

        // Get FingerprintJS visitorId (required, no fallback)
        return import('https://fpjscdn.net/v3/TbkpbBFNZYNv2uCOZqDD')
            .then(function (FingerprintJS) {
                return FingerprintJS.load({
                    region: "eu"
                });
            })
            .then(function (fp) {
                return fp.get();
            })
            .then(function (result) {
                var visitorId = result.visitorId;
                self.log('FingerprintJS visitorId:', visitorId);

                // Store the fingerprint user ID
                localStorage.setItem('platformance_user_id', visitorId);
                self.userId = visitorId;
                return visitorId;
            })
            .catch(function (error) {
                self.log('FingerprintJS failed:', error);
                throw new Error('Failed to generate user ID with FingerprintJS: ' + error.message);
            });
    };

    PlatformanceTracker.prototype.getUserId = function () {
        return this.userId;
    };

    PlatformanceTracker.prototype.processGlobalQueue = function () {
        var self = this;
        var globalQueue = window.pfQueue || window.platformanceQueue || [];

        self.log('Processing global queue. Found ' + globalQueue.length + ' events');

        // Process each queued command
        for (var i = 0; i < globalQueue.length; i++) {
            var command = globalQueue[i];

            if (Array.isArray(command) && command.length >= 2) {
                var action = command[0];
                var eventType = command[1];
                var additionalData = command[2] || {};

                if (action === 'track' || action === 'trackEvent') {
                    self.log('Processing queued event:', eventType, additionalData);
                    self.trackEvent(eventType, additionalData);
                } else if (action === 'config') {
                    // Handle configuration updates
                    self.log('Processing queued config:', command);
                    if (eventType && typeof eventType === 'object') {
                        Object.assign(self.options, eventType);
                    }
                }
            } else {
                self.log('Invalid queue command format:', command);
            }
        }

        // Clear the processed queue
        globalQueue.length = 0;

        // Replace the global queue with a function that directly calls trackEvent
        window.pfQueue = window.platformanceQueue = function () {
            var args = Array.prototype.slice.call(arguments);
            if (args.length >= 2) {
                var action = args[0];
                var eventType = args[1];
                var additionalData = args[2] || {};

                if (action === 'track' || action === 'trackEvent') {
                    // If not initialized yet, queue the event for later processing
                    if (!self.isInitialized) {
                        self.log('Queueing event until initialization:', eventType);
                        // Store in a temporary queue until initialized
                        if (!self.pendingEvents) {
                            self.pendingEvents = [];
                        }
                        self.pendingEvents.push([action, eventType, additionalData]);
                    } else {
                        self.trackEvent(eventType, additionalData);
                    }
                } else if (action === 'config' && eventType && typeof eventType === 'object') {
                    Object.assign(self.options, eventType);
                }
            }
        };

        // Also add a push method for array-like behavior
        window.pfQueue.push = window.platformanceQueue.push = function (command) {
            if (Array.isArray(command) && command.length >= 2) {
                window.pfQueue.apply(window, command);
            }
        };
    };

    PlatformanceTracker.prototype.getBrowserInfo = function () {
        var screen = window.screen || {};
        var nav = window.navigator || {};
        var doc = document.documentElement || {};
        var body = document.body || {};

        return {
            browser_screen_width: screen.width || 0,
            browser_screen_height: screen.height || 0,
            browser_viewport_width: window.innerWidth || doc.clientWidth || body.clientWidth || 0,
            browser_viewport_height: window.innerHeight || doc.clientHeight || body.clientHeight || 0,
            browser_page_height: Math.max(
                body.scrollHeight || 0,
                body.offsetHeight || 0,
                doc.clientHeight || 0,
                doc.scrollHeight || 0,
                doc.offsetHeight || 0
            ),
            browser_device_pixel_ratio: window.devicePixelRatio || 1,
            browser_language: nav.language || nav.userLanguage || '',
            browser_platform: nav.platform || '',
            browser_cpu_cores: nav.hardwareConcurrency || null,
            browser_connection_type: (nav.connection ? nav.connection.effectiveType : null),
            browser_cookie_enabled: nav.cookieEnabled || false,
            browser_referrer: document.referrer || '',
            browser_url: window.location.href || '',
            browser_hostname: window.location.hostname || '',
            browser_pathname: window.location.pathname || '',
            browser_query_string: window.location.search || '',
            browser_session_id: this.sessionId,
            browser_user_id: this.getUserId()
        };
    };

    PlatformanceTracker.prototype.calculateScrollInfo = function () {
        var doc = document.documentElement || {};
        var body = document.body || {};
        var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
        var totalHeight = Math.max(
            body.scrollHeight || 0,
            body.offsetHeight || 0,
            doc.clientHeight || 0,
            doc.scrollHeight || 0,
            doc.offsetHeight || 0
        );
        var viewportHeight = window.innerHeight || doc.clientHeight || body.clientHeight || 0;
        var scrollPercent = totalHeight <= viewportHeight ? 100 : (scrollTop / (totalHeight - viewportHeight)) * 100;

        return {
            browser_scroll_percent: Math.min(Math.max(scrollPercent, 0), 100),
            browser_scroll_position_px: scrollTop,
            browser_total_page_height: totalHeight
        };
    };

    PlatformanceTracker.prototype.addToQueue = function (eventType, additionalData) {
        var self = this;
        var browserInfo = this.getBrowserInfo();
        var scrollInfo = this.calculateScrollInfo();

        var payload = {
            event_type: eventType,
            timestamp: new Date().toISOString(),
            retry_count: 0,
            additional_data: additionalData || {}
        };

        // Merge browser and scroll info, but keep additionalData separate
        Object.assign(payload, browserInfo, scrollInfo);

        this.queue.push(payload);
        this.log('Event queued:', eventType, payload);

        if (this.queue.length >= this.batchSize) {
            this.processQueue();
        }
    };

    PlatformanceTracker.prototype.processBatchedEvents = function () {
        var self = this;

        // Process queue immediately if there are events
        if (self.queue.length > 0) {
            self.processQueue();
        }

        // Set up interval for continuous processing
        setInterval(function () {
            if (self.queue.length > 0) {
                self.processQueue();
            }
        }, this.batchTimeout);
    };

    PlatformanceTracker.prototype.processQueue = function () {
        var self = this;

        self.log('Processing queue. Current queue length:', this.queue.length);

        if (this.queue.length === 0) {
            self.log('Queue is empty, nothing to process');
            return;
        }

        var events = this.queue.splice(0, this.batchSize);
        self.log('Processing batch of events:', events.length);

        events.forEach(function (event) {
            self.log('Processing event:', event.event_type);

            self.sendEvent(event).then(function (success) {
                if (!success) {
                    event.retry_count = (event.retry_count || 0) + 1;
                    self.log('Event failed, retry count:', event.retry_count);

                    if (event.retry_count < self.maxRetries) {
                        self.log('Requeueing event for retry:', event.event_type);
                        self.queue.push(event);
                    } else {
                        self.log('Failed to send event after max retries:', event);
                    }
                } else {
                    self.log('Event processed successfully:', event.event_type);
                }
            }).catch(function (error) {
                self.log('Error in processQueue:', error);
                // Requeue the event on error
                self.queue.push(event);
            });
        });
    };

    PlatformanceTracker.prototype.sendEvent = function (event) {
        var self = this;
        var url = this.apiBase + '/sites/' + this.siteId + '/events/' + event.event_type;

        return new Promise(function (resolve) {
            try {
                var xhr = new XMLHttpRequest();

                // Log the attempt
                self.log('Attempting to send event:', {
                    eventType: event.event_type,
                    url: url,
                    siteId: self.siteId
                });

                // Add timeout handling
                xhr.timeout = 5000; // 5 second timeout

                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');

                // Add CORS headers if needed
                xhr.withCredentials = false;

                xhr.onreadystatechange = function () {
                    self.log('XHR state changed:', xhr.readyState, 'Status:', xhr.status);
                    if (xhr.readyState === 4) {
                        var success = xhr.status >= 200 && xhr.status < 300;
                        if (success) {
                            self.log('Event sent successfully:', event.event_type);
                        } else {
                            self.log('API call failed:', {
                                url: url,
                                status: xhr.status,
                                statusText: xhr.statusText,
                                response: xhr.responseText,
                                event: event
                            });
                        }
                        resolve(success);
                    }
                };

                xhr.onerror = function (error) {
                    self.log('Network error:', {
                        url: url,
                        error: error,
                        event: event,
                        errorType: error.type,
                        errorMessage: error.message
                    });
                    resolve(false);
                };

                xhr.ontimeout = function () {
                    self.log('Request timeout:', {
                        url: url,
                        event: event
                    });
                    resolve(false);
                };

                // Prepare payload
                var payload = Object.assign({}, event);
                delete payload.event_type;
                delete payload.retry_count;

                // Extract additional_data and send it as arbitrary_data
                var additionalData = payload.additional_data || {};
                delete payload.additional_data;

                // Add arbitrary_data as JSON stringified
                if (Object.keys(additionalData).length > 0) {
                    payload.arbitrary_data = JSON.stringify(additionalData);
                }

                self.log('Sending payload:', {
                    url: url,
                    payload: payload
                });

                var jsonPayload = JSON.stringify(payload);
                self.log('Stringified payload:', jsonPayload);

                xhr.send(jsonPayload);
            } catch (e) {
                self.log('Error in sendEvent:', e.message, e.stack);
                resolve(false);
            }
        });
    };

    PlatformanceTracker.prototype.isCustomEvent = function (eventType) {
        return !Object.values(EVENT_TYPES).includes(eventType);
    };

    PlatformanceTracker.prototype.validateAndFormatEventType = function (eventType) {
        if (this.isCustomEvent(eventType)) {
            if (!eventType.startsWith('custom_')) {
                eventType = 'custom_' + eventType;
            }
        } else if (!Object.values(EVENT_TYPES).includes(eventType)) {
            throw new Error('Invalid event type: ' + eventType);
        }
        return eventType;
    };

    PlatformanceTracker.prototype.trackEvent = function (eventType, additionalData) {
        // Only track events if the tracker is initialized (has fingerprint user ID)
        if (!this.isInitialized) {
            this.log('Tracker not initialized yet, skipping event:', eventType);
            return;
        }

        try {
            var validatedEventType = this.validateAndFormatEventType(eventType);
            this.addToQueue(validatedEventType, additionalData);
        } catch (e) {
            this.log('Error tracking event:', e);
        }
    };

    PlatformanceTracker.prototype.initializeEventListeners = function () {
        var self = this;

        // Helper for cross-browser event listener
        function addEvent(element, type, handler) {
            if (element.addEventListener) {
                element.addEventListener(type, handler, false);
            } else if (element.attachEvent) {
                element.attachEvent('on' + type, handler);
            }
        }

        // Track any potential missed viewability changes
        // addEvent(window, 'load', function () {
        //     // Double check viewability after everything is loaded
        //     if (document.visibilityState === 'visible') {
        //         self.trackEvent(EVENT_TYPES.IMPRESSION);
        //     }
        // });


        // Click events
        addEvent(document, 'click', function (event) {
            event = event || window.event;
            var target = event.target || event.srcElement;
            self.trackEvent(EVENT_TYPES.CLICK, {
                browser_element_tag: (target.tagName || '').toLowerCase(),
                browser_element_id: target.id || '',
                browser_element_class: target.className || '',
                browser_element_text: (target.innerText || target.textContent || '').substring(0, 100)
            });
        });

        // Track exit clicks (links leading outside the current domain)
        addEvent(document, 'click', function (event) {
            event = event || window.event;
            var target = event.target || event.srcElement;
            var link = target.closest('a');
            if (link && link.href && link.hostname !== window.location.hostname) {
                self.trackEvent(EVENT_TYPES.EXIT);
            }
        });

        // Track close/exit events
        if (typeof document.hidden !== 'undefined') {
            addEvent(document, 'visibilitychange', function () {
                if (document.hidden) {
                    self.trackEvent(EVENT_TYPES.CLOSE);
                }
            });
        }

        // Track window focus
        addEvent(window, 'focus', function () {
            self.trackEvent(EVENT_TYPES.IMPRESSION);
        });

        // Session end when user leaves the page
        addEvent(window, 'beforeunload', function () {
            self.trackEvent(EVENT_TYPES.SESSION_END);
            self.processQueue(); // Try to process any remaining events
        });
    };

    // Auto-initialization logic
    function autoInitialize() {
        // Prevent multiple initialization - if tracker already exists, don't initialize again
        if (window.pfTracker) {
            return;
        }

        // Find the current script tag that loaded this tracker
        var scripts = document.getElementsByTagName('script');
        var siteId = null;

        for (var i = 0; i < scripts.length; i++) {
            var script = scripts[i];
            if ((script.src.includes('localhost') || script.src.includes('127.0.0.1')) || (script.src && script.src.includes('https://pixel.data.platformance.io/tracker.min.js'))) {
                var match = script.src.match(/[?&]siteid=([0-9a-zA-Z_-]+)/i);
                if (match && match[1]) {
                    siteId = match[1];
                    break;
                }
            }
        }

        // If we found a siteId, auto-initialize the tracker
        if (siteId) {
            try {
                // Create the tracker instance and make it globally available
                window.pfTracker = new PlatformanceTracker(siteId);
            } catch (e) {
                // Log error but don't break the page
                if (window.console && window.console.error) {
                    console.error('PlatformanceTracker auto-initialization failed:', e);
                }
            }
        }
    }

    // Export the tracker
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PlatformanceTracker;
    } else {
        window.PlatformanceTracker = PlatformanceTracker;

        // Auto-initialize if we're in a browser environment
        if (typeof document !== 'undefined') {
            // Run auto-initialization after DOM is ready or immediately if DOM is already ready
            if (document.readyState === 'loading') {
                if (document.addEventListener) {
                    document.addEventListener('DOMContentLoaded', autoInitialize);
                } else if (document.attachEvent) {
                    document.attachEvent('onreadystatechange', function () {
                        if (document.readyState !== 'loading') {
                            autoInitialize();
                        }
                    });
                }
            } else {
                // DOM is already ready, initialize immediately
                autoInitialize();
            }
        }
    }
})(typeof window !== 'undefined' ? window : this);