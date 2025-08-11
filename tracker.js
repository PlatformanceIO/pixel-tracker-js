; (function (window) {
    // Initialize global queue if it doesn't exist
    window.pfQueue = window.pfQueue || [];
    window.platformanceQueue = window.platformanceQueue || [];

    // Initialize site-specific queues storage
    window.pfSiteQueues = window.pfSiteQueues || {};

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
        this.userIdType = null; // Will be set to 'fingerprint' or 'local' when user ID is generated
        this.storageClient = null; // Will be set after storage layer is loaded
        this.siteConfig = null; // Will be set after config is loaded
        this.lastScrollPosition = 0;
        this.lastScrollTime = this.now();
        this.queue = [];
        this.maxRetries = this.options.maxRetries || 3;
        this.retryTimeout = this.options.retryTimeout || 1000;
        this.batchSize = this.options.batchSize || 10;
        this.batchTimeout = this.options.batchTimeout || 1000;
        this.debug = this.options.debug || false;
        this.isInitialized = false;
        this.firstImpressionRecorded = false;
        this.onFirstImpressionCallbacks = [];
        this.referenceEventId = null; // Will store pfclid from URL or localStorage

        // Initialize reference event ID from URL or localStorage
        this.initializeReferenceEventId();

        // Initialize the tracker after loading config and getting the user ID
        this.initialize();
    };

    PlatformanceTracker.prototype.now = function () {
        return Date.now ? Date.now() : new Date().getTime();
    };

    PlatformanceTracker.prototype.initializeReferenceEventId = function () {
        var self = this;

        // First, try to get pfclid from current URL
        var queryString = window.location.search || '';
        var pfclid = null;

        if (queryString) {
            var urlParams = new URLSearchParams ? new URLSearchParams(queryString) : null;
            if (urlParams) {
                pfclid = urlParams.get('pfclid');
            } else {
                // Fallback for older browsers
                var match = queryString.match(/[?&]pfclid=([^&]*)/);
                if (match && match[1]) {
                    pfclid = decodeURIComponent(match[1]);
                }
            }
        }

        // If pfclid found in URL, store it in localStorage and use it
        if (pfclid) {
            self.log('Found pfclid in URL:', pfclid);
            try {
                localStorage.setItem('platformance_reference_event_id', pfclid);
                self.referenceEventId = pfclid;
                self.log('Stored pfclid in localStorage');
            } catch (error) {
                self.log('Failed to store pfclid in localStorage:', error);
                self.referenceEventId = pfclid; // Still use it for this session
            }
        } else {
            // No pfclid in URL, try to get it from localStorage
            try {
                var storedPfclid = localStorage.getItem('platformance_reference_event_id');
                if (storedPfclid) {
                    self.referenceEventId = storedPfclid;
                    self.log('Retrieved pfclid from localStorage:', storedPfclid);
                }
            } catch (error) {
                self.log('Failed to retrieve pfclid from localStorage:', error);
            }
        }

        self.log('Reference event ID initialized:', self.referenceEventId);
    };

    PlatformanceTracker.prototype.log = function () {
        if (this.debug && window.console && window.console.log) {
            console.log.apply(console, arguments);
        }
    };

    PlatformanceTracker.prototype.loadSiteConfig = function () {
        var self = this;
        return new Promise(function (resolve) {
            var configUrl = 'https://pixel.data.platformance.io/sites/' + self.siteId + '.json';

            self.log('Loading site configuration from:', configUrl);

            var xhr = new XMLHttpRequest();
            xhr.timeout = 5000; // 5 second timeout

            xhr.open('GET', configUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');

            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var config = JSON.parse(xhr.responseText);
                            self.siteConfig = config;
                            self.log('Site configuration loaded successfully:', config);
                            resolve(config);
                        } catch (error) {
                            self.log('Failed to parse site configuration:', error);
                            // Use default config if parsing fails
                            self.siteConfig = { enable_fingerprint: false };
                            resolve(self.siteConfig);
                        }
                    } else {
                        self.log('Failed to load site configuration, status:', xhr.status);
                        // Use default config if request fails
                        self.siteConfig = { enable_fingerprint: false };
                        resolve(self.siteConfig);
                    }
                }
            };

            xhr.onerror = function () {
                self.log('Network error loading site configuration');
                // Use default config if network error
                self.siteConfig = { enable_fingerprint: true };
                resolve(self.siteConfig);
            };

            xhr.ontimeout = function () {
                self.log('Timeout loading site configuration');
                // Use default config if timeout
                self.siteConfig = { enable_fingerprint: true };
                resolve(self.siteConfig);
            };

            xhr.send();
        });
    };

    PlatformanceTracker.prototype.loadStorageLayerClient = function () {
        var self = this;
        return new Promise(function (resolve) {
            // Check if storage layer client is already loaded and connected
            if (self.storageClient && self.storageClient.connected) {
                self.log('Storage layer client already loaded and connected');
                resolve();
                return;
            }

            var script = document.createElement('script');
            script.src = 'https://pixel.data.platformance.io/storage-layer/client.min.js';
            script.async = true;

            script.onload = function () {
                self.log('Storage layer client script loaded successfully');

                // Initialize the CrossStorageClient
                try {
                    self.storageClient = new CrossStorageClient('https://pixel.data.platformance.io/storage-layer/hub.html');
                    self.log('CrossStorageClient instantiated, waiting for connection...');

                    // Wait for the storage client to connect
                    self.storageClient.onConnect().then(function () {
                        self.log('CrossStorageClient connected and ready!');
                        resolve();
                    }).catch(function (error) {
                        self.log('CrossStorageClient connection failed:', error);
                        resolve(); // Resolve anyway to not block tracker initialization
                    });

                } catch (error) {
                    self.log('Failed to instantiate CrossStorageClient:', error);
                    resolve(); // Resolve anyway to not block tracker initialization
                }
            };

            script.onerror = function () {
                self.log('Failed to load storage layer client script, continuing without it');
                resolve(); // Resolve anyway to not block tracker initialization
            };

            document.head.appendChild(script);
        });
    };

    PlatformanceTracker.prototype.initialize = function () {
        var self = this;

        self.log('Initializing PlatformanceTracker, loading site configuration...');

        // Load site config first, then storage layer client, then generate user ID
        this.loadSiteConfig()
            .then(function (config) {
                self.log('Site configuration loaded, now loading storage layer client...');
                return self.loadStorageLayerClient();
            })
            .then(function () {
                self.log('Storage layer client ready, now generating user ID...');
                return self.generateUserId();
            })
            .then(function (userId) {
                self.userId = userId;
                self.isInitialized = true;
                self.log('PlatformanceTracker initialized with user ID:', userId);

                // Now start processing everything - moved inside the "ready" state
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
                // self.trackEvent(EVENT_TYPES.SESSION_START);
                self.trackEvent(EVENT_TYPES.IMPRESSION);
            })
            .catch(function (error) {
                self.log('Failed to initialize PlatformanceTracker:', error);
                // Try to initialize with a basic fallback ID as last resort
                try {
                    self.userId = 'fallback_' + self.generateSessionId();
                    self.userIdType = 'local'; // Fallback is considered local type
                    self.isInitialized = true;
                    self.log('PlatformanceTracker initialized with fallback user ID:', self.userId);

                    self.processGlobalQueue();
                    self.processBatchedEvents();
                    self.initializeEventListeners();

                    // Track initial events
                    // self.trackEvent(EVENT_TYPES.SESSION_START);
                    self.trackEvent(EVENT_TYPES.IMPRESSION);
                } catch (fallbackError) {
                    self.log('Complete initialization failure:', fallbackError);
                }
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

        // Check if we have a stored user ID using the storage client
        if (self.storageClient) {
            return self.storageClient.get('platformance_user_id').then(function (storedUserId) {
                if (storedUserId) {
                    self.log('Found stored user ID:', storedUserId);
                    self.userId = storedUserId;
                    // Determine user ID type based on the stored ID format
                    if (storedUserId.startsWith('local_')) {
                        self.userIdType = 'local';
                    } else {
                        self.userIdType = 'fingerprint';
                    }
                    return storedUserId;
                }

                // No stored ID found, generate a new one
                return self.generateNewUserId();
            }).catch(function (error) {
                self.log('Error getting stored user ID, generating new one:', error);
                return self.generateNewUserId();
            });
        } else {
            // Fallback to generating new ID if no storage client
            self.log('No storage client available, generating new user ID');
            return self.generateNewUserId();
        }
    };

    PlatformanceTracker.prototype.generateNewUserId = function () {
        var self = this;

        // Check if fingerprinting is enabled in the site config
        if (self.siteConfig && self.siteConfig.enable_fingerprint === true) {
            self.log('Fingerprinting enabled, attempting to use FingerprintJS');
            // Try FingerprintJS first, fallback to local ID generation if it fails
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

                    // Store the fingerprint user ID using storage client
                    if (self.storageClient) {
                        self.storageClient.set('platformance_user_id', visitorId);
                        self.log('User ID stored successfully via storage client');
                    } else {
                        self.log('No storage client available, user ID not persisted');
                    }

                    self.userId = visitorId;
                    self.userIdType = 'fingerprint';
                    return visitorId;
                })
                .catch(function (error) {
                    self.log('FingerprintJS failed, falling back to local ID generation:', error);
                    return self.generateLocalUserId();
                });
        } else {
            self.log('Fingerprinting disabled in site config, generating local user ID');
            return self.generateLocalUserId();
        }




    };

    PlatformanceTracker.prototype.generateLocalUserId = function () {
        var self = this;

        // Generate a local user ID based on browser characteristics
        var nav = window.navigator || {};
        var screen = window.screen || {};

        // Collect browser characteristics for fingerprinting
        var characteristics = [
            nav.userAgent || '',
            nav.language || '',
            nav.platform || '',
            screen.width || 0,
            screen.height || 0,
            screen.colorDepth || 0,
            window.devicePixelRatio || 1,
            new Date().getTimezoneOffset(),
            nav.hardwareConcurrency || 0,
            nav.maxTouchPoints || 0
        ].join('|');

        // Create a simple hash of the characteristics
        var hash = 0;
        for (var i = 0; i < characteristics.length; i++) {
            var char = characteristics.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        // Convert to positive number and add timestamp for uniqueness
        var localId = 'local_' + Math.abs(hash).toString(36) + '_' + this.now().toString(36);

        self.log('Generated local user ID:', localId);

        // Store the local user ID using storage client
        if (self.storageClient) {
            self.storageClient.set('platformance_user_id', localId).then(function () {
                self.log('Local user ID stored successfully via storage client');
            }).catch(function (error) {
                self.log('Failed to store local user ID:', error);
            });
        } else {
            self.log('No storage client available, local user ID not persisted');
        }

        self.userId = localId;
        self.userIdType = 'local';
        return Promise.resolve(localId);
    };

    PlatformanceTracker.prototype.getUserId = function () {
        return this.userId;
    };

    PlatformanceTracker.prototype.getUserIdType = function () {
        return this.userIdType;
    };

    PlatformanceTracker.prototype.getStorageClient = function () {
        return this.storageClient;
    };

    PlatformanceTracker.prototype.getSiteConfig = function () {
        return this.siteConfig;
    };

    PlatformanceTracker.prototype.getReferenceEventId = function () {
        return this.referenceEventId;
    };

    PlatformanceTracker.prototype.onFirstImpression = function (callback) {
        if (typeof callback !== 'function') {
            this.log('onFirstImpression: callback must be a function');
            return;
        }

        if (this.firstImpressionRecorded) {
            // First impression already recorded, call callback immediately
            this.log('First impression already recorded, calling callback immediately');
            try {
                callback();
            } catch (error) {
                this.log('Error in first impression callback:', error);
            }
        } else {
            // Add to callbacks array to be called when first impression is recorded
            this.onFirstImpressionCallbacks.push(callback);
            this.log('Added callback for first impression event');
        }
    };

    PlatformanceTracker.prototype.triggerFirstImpressionCallbacks = function () {
        if (this.firstImpressionRecorded || this.onFirstImpressionCallbacks.length === 0) {
            return;
        }

        this.log('Triggering first impression callbacks (' + this.onFirstImpressionCallbacks.length + ')');
        this.firstImpressionRecorded = true;

        // Dispatch custom event on window
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            try {
                var event = document.createEvent ? document.createEvent('Event') : new Event('platformanceFirstImpression');
                if (document.createEvent) {
                    event.initEvent('platformanceFirstImpression', true, true);
                }
                window.dispatchEvent(event);
                this.log('Dispatched platformanceFirstImpression event');
            } catch (error) {
                this.log('Error dispatching first impression event:', error);
            }
        }

        // Call all registered callbacks
        for (var i = 0; i < this.onFirstImpressionCallbacks.length; i++) {
            try {
                this.onFirstImpressionCallbacks[i]();
            } catch (error) {
                this.log('Error in first impression callback:', error);
            }
        }

        // Clear callbacks array
        this.onFirstImpressionCallbacks = [];
    };

    PlatformanceTracker.prototype.processGlobalQueue = function () {
        var self = this;
        var globalQueue = window.pfQueue || window.platformanceQueue || [];
        var siteSpecificQueue = window.pfSiteQueues[this.siteId] || [];

        self.log('Processing global queue. Found ' + globalQueue.length + ' global events and ' + siteSpecificQueue.length + ' site-specific events');

        // Process global queue first (backwards compatibility)
        for (var i = 0; i < globalQueue.length; i++) {
            var command = globalQueue[i];
            this.processQueueCommand(command);
        }

        // Process site-specific queue
        for (var j = 0; j < siteSpecificQueue.length; j++) {
            var siteCommand = siteSpecificQueue[j];
            this.processQueueCommand(siteCommand);
        }

        // Clear the processed queues
        globalQueue.length = 0;
        if (window.pfSiteQueues[this.siteId]) {
            window.pfSiteQueues[this.siteId].length = 0;
        }

        // Replace the global queue with a function that routes to appropriate tracker
        if (!window.pfQueueInitialized) {
            window.pfQueueInitialized = true;

            window.pfQueue = window.platformanceQueue = function () {
                var args = Array.prototype.slice.call(arguments);
                if (args.length >= 1) {
                    var action = args[0];
                    var eventType = args[1];
                    var additionalData = args[2] || {};
                    var targetSiteId = args[3]; // Optional site ID parameter

                    // If site ID is specified, route to that specific tracker
                    if (targetSiteId && window.pfTrackers && window.pfTrackers[targetSiteId]) {
                        var targetTracker = window.pfTrackers[targetSiteId];
                        if (action === 'track' || action === 'trackEvent') {
                            if (!targetTracker.isInitialized) {
                                targetTracker.log('Queueing event until initialization:', eventType);
                                if (!targetTracker.pendingEvents) {
                                    targetTracker.pendingEvents = [];
                                }
                                targetTracker.pendingEvents.push([action, eventType, additionalData]);
                            } else {
                                targetTracker.trackEvent(eventType, additionalData);
                            }
                        } else if (action === 'onFirstImpression') {
                            if (typeof eventType === 'function') {
                                targetTracker.onFirstImpression(eventType);
                            }
                        } else if (action === 'config' && eventType && typeof eventType === 'object') {
                            Object.assign(targetTracker.options, eventType);
                        }
                        return;
                    }

                    // No site ID specified, send to all trackers (backwards compatibility)
                    if (window.pfTrackers) {
                        for (var siteId in window.pfTrackers) {
                            if (window.pfTrackers.hasOwnProperty(siteId)) {
                                var tracker = window.pfTrackers[siteId];
                                if (action === 'track' || action === 'trackEvent') {
                                    if (!tracker.isInitialized) {
                                        tracker.log('Queueing event until initialization:', eventType);
                                        if (!tracker.pendingEvents) {
                                            tracker.pendingEvents = [];
                                        }
                                        tracker.pendingEvents.push([action, eventType, additionalData]);
                                    } else {
                                        tracker.trackEvent(eventType, additionalData);
                                    }
                                } else if (action === 'onFirstImpression') {
                                    if (typeof eventType === 'function') {
                                        tracker.onFirstImpression(eventType);
                                    }
                                } else if (action === 'config' && eventType && typeof eventType === 'object') {
                                    Object.assign(tracker.options, eventType);
                                }
                            }
                        }
                    } else {
                        // No trackers initialized yet, queue for later
                        if (!window.pfSiteQueues['_global']) {
                            window.pfSiteQueues['_global'] = [];
                        }
                        window.pfSiteQueues['_global'].push([action, eventType, additionalData]);
                    }
                }
            };

            // Also add a push method for array-like behavior
            window.pfQueue.push = window.platformanceQueue.push = function (command) {
                if (Array.isArray(command) && command.length >= 1) {
                    window.pfQueue.apply(window, command);
                }
            };
        }
    };

    PlatformanceTracker.prototype.processQueueCommand = function (command) {
        var self = this;

        if (Array.isArray(command) && command.length >= 2) {
            var action = command[0];
            var eventType = command[1];
            var additionalData = command[2] || {};

            if (action === 'track' || action === 'trackEvent') {
                self.log('Processing queued event:', eventType, additionalData);
                self.trackEvent(eventType, additionalData);
            } else if (action === 'onFirstImpression') {
                // Handle first impression callback registration
                self.log('Processing queued first impression callback');
                if (typeof eventType === 'function') {
                    self.onFirstImpression(eventType);
                }
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
    };

    PlatformanceTracker.prototype.getBrowserInfo = function () {
        var screen = window.screen || {};
        var nav = window.navigator || {};
        var doc = document.documentElement || {};
        var body = document.body || {};

        var browserInfo = {
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
            browser_user_id: this.getUserId(),
            user_id: this.getUserId(),
            user_id_type: this.userIdType || 'unknown'
        };

        // Add reference_event_id if we have one stored
        if (this.referenceEventId) {
            browserInfo.reference_event_id = this.referenceEventId;
        }

        return browserInfo;
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
        var processedAdditionalData = additionalData || {};

        // Whitelist of allowed browser properties that can be set directly in payload
        var allowedBrowserProperties = [
            'browser_element_tag',
            'browser_element_id',
            'browser_element_class',
            'browser_element_text'
        ];

        // Separate whitelisted browser properties from arbitrary data
        var browserProperties = {};
        var arbitraryData = {};

        for (var key in processedAdditionalData) {
            if (processedAdditionalData.hasOwnProperty(key)) {
                if (allowedBrowserProperties.indexOf(key) !== -1) {
                    // Whitelisted browser property - add to browserProperties only
                    browserProperties[key] = processedAdditionalData[key];
                } else {
                    // Non-whitelisted property - add to arbitraryData only
                    arbitraryData[key] = processedAdditionalData[key];
                }
            }
        }

        var payload = {
            event_type: eventType,
            timestamp: new Date().toISOString(),
            retry_count: 0,
            additional_data: Object.keys(arbitraryData).length > 0 ? arbitraryData : {}
        };

        // Merge browser and scroll info, plus whitelisted browser properties from additionalData
        Object.assign(payload, browserInfo, scrollInfo, browserProperties);

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
                    // self.log('XHR state changed:', xhr.readyState, 'Status:', xhr.status);
                    if (xhr.readyState === 4) {
                        var success = xhr.status >= 200 && xhr.status < 300;
                        if (success) {
                            self.log('Event sent successfully:', event.event_type);

                            // Trigger first impression callbacks if this is an impression event
                            if (event.event_type === EVENT_TYPES.IMPRESSION && !self.firstImpressionRecorded) {
                                self.triggerFirstImpressionCallbacks();
                            }
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
                // self.log('Stringified payload:', jsonPayload);

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
        // Find the current script tag that loaded this tracker
        var scripts = document.getElementsByTagName('script');
        var siteId = null;
        var debugMode = false;

        for (var i = 0; i < scripts.length; i++) {
            var script = scripts[i];
            // Check for both localhost and production URLs
            if (
                script.src &&
                (
                    script.src.includes('https://pixel.data.platformance.io/tracker.min.js') ||
                    script.src.includes('http://localhost:5500/tracker.js')
                )
            ) {
                var match = script.src.match(/[?&]siteid=([0-9a-zA-Z_-]+)/i);
                if (match && match[1]) {
                    siteId = match[1];

                    // Check for debug parameter
                    var debugMatch = script.src.match(/[?&]debug=(true|1)/i);
                    if (debugMatch) {
                        debugMode = true;
                    }
                    break;
                }
            }
        }

        // If we found a siteId, check if tracker for this site ID already exists
        if (siteId) {
            // Initialize trackers array if it doesn't exist
            if (!window.pfTrackers) {
                window.pfTrackers = {};
            }

            // Check if tracker for this site ID already exists
            if (window.pfTrackers[siteId]) {
                if (window.console && window.console.log) {
                    console.log('PlatformanceTracker for site ID', siteId, 'already exists, skipping initialization');
                }
                return;
            }

            try {
                // Create the tracker instance with debug option
                var options = {};
                if (debugMode) {
                    options.debug = true;
                }
                var tracker = new PlatformanceTracker(siteId, options);

                // Store tracker in the trackers object by site ID
                window.pfTrackers[siteId] = tracker;

                // Process any global events that were queued for later
                if (window.pfSiteQueues['_global']) {
                    var globalEvents = window.pfSiteQueues['_global'];
                    for (var k = 0; k < globalEvents.length; k++) {
                        var globalEvent = globalEvents[k];
                        var action = globalEvent[0];
                        var eventType = globalEvent[1];
                        var additionalData = globalEvent[2] || {};

                        if (action === 'track' || action === 'trackEvent') {
                            if (!tracker.isInitialized) {
                                if (!tracker.pendingEvents) {
                                    tracker.pendingEvents = [];
                                }
                                tracker.pendingEvents.push([action, eventType, additionalData]);
                            } else {
                                tracker.trackEvent(eventType, additionalData);
                            }
                        } else if (action === 'onFirstImpression') {
                            if (typeof eventType === 'function') {
                                tracker.onFirstImpression(eventType);
                            }
                        } else if (action === 'config' && eventType && typeof eventType === 'object') {
                            Object.assign(tracker.options, eventType);
                        }
                    }
                    // Clear global events after processing by first tracker
                    if (Object.keys(window.pfTrackers).length === 1) {
                        window.pfSiteQueues['_global'] = [];
                    }
                }

                // Keep backward compatibility - set the first tracker as the global pfTracker
                if (!window.pfTracker) {
                    window.pfTracker = tracker;
                }
            } catch (e) {
                // Log error but don't break the page
                if (window.console && window.console.error) {
                    console.error('PlatformanceTracker auto-initialization failed:', e);
                }
            }
        }
    }

    // Helper function to get tracker by site ID
    function getTrackerBySiteId(siteId) {
        return window.pfTrackers && window.pfTrackers[siteId] ? window.pfTrackers[siteId] : null;
    }

    // Helper function to queue events for a specific site ID
    function queueForSite(siteId, action, eventType, additionalData) {
        if (!window.pfSiteQueues[siteId]) {
            window.pfSiteQueues[siteId] = [];
        }
        window.pfSiteQueues[siteId].push([action, eventType, additionalData]);
    }

    // Export the tracker
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PlatformanceTracker;
    } else {
        window.PlatformanceTracker = PlatformanceTracker;
        window.getTrackerBySiteId = getTrackerBySiteId;
        window.queueForSite = queueForSite;

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