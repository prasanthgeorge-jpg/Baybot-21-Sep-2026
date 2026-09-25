// BayBot Dynamics - Interactive JavaScript

// --------------------------------------------------------------------------
// Form delivery
// Set FORM_ENDPOINT to a form backend URL to have submissions posted there
// directly. Any service that accepts a multipart POST works, e.g. Formspree
// (https://formspree.io/f/xxxx) or Web3Forms. Left empty, forms fall back to
// opening the visitor's email client addressed to CONTACT_EMAIL, so no
// enquiry is ever silently dropped.
// --------------------------------------------------------------------------
const FORM_ENDPOINT = '';
const CONTACT_EMAIL = 'info@baybotdynamics.com';

function buildMailto(subject, data) {
    const labels = {
        name: 'Name', email: 'Email', phone: 'Phone', company: 'Company',
        industry: 'Industry', demoType: 'Demo type', model: 'Robot model',
        serial: 'Serial number', message: 'Message'
    };
    const body = Object.entries(data)
        .filter(([, value]) => String(value).trim() !== '')
        .map(([key, value]) => (labels[key] || key) + ': ' + value)
        .join('\n');
    return 'mailto:' + CONTACT_EMAIL +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
}

// Wraps a plain <input type="tel"> with the intl-tel-input country
// dropdown/flag picker, defaulting to the US. Returns null on pages where
// the library script wasn't loaded, so callers can fall back gracefully.
function setupPhoneInput(inputEl) {
    if (!inputEl || typeof window.intlTelInput !== 'function') return null;
    return window.intlTelInput(inputEl, {
        initialCountry: 'us',
        separateDialCode: true,
        strictMode: true
    });
}

document.addEventListener('DOMContentLoaded', function() {
    // Mobile Menu Toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navMenu = document.getElementById('navMenu');
    const navbar = document.getElementById('navbar');

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function() {
            const open = navMenu.classList.toggle('active');
            this.classList.toggle('active', open);
            this.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    // Close mobile menu when clicking outside
    document.addEventListener('click', function(event) {
        if (navMenu && navMenu.classList.contains('active')) {
            if (!event.target.closest('.nav-container')) {
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                navMenu.classList.remove('active');
            }
        }
    });

    // Mobile dropdown toggle
    const dropdownToggles = document.querySelectorAll('.has-dropdown > a');
    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            if (window.innerWidth <= 968) {
                e.preventDefault();
                const parent = this.parentElement;
                parent.classList.toggle('active');
            }
        });
    });

    // Navbar scroll effect
    let lastScroll = 0;
    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 100) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });

    // Accordion functionality
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', function() {
            const accordionItem = this.parentElement;
            const isActive = accordionItem.classList.contains('active');

            // Close all accordion items
            document.querySelectorAll('.accordion-item').forEach(item => {
                item.classList.remove('active');
                item.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
            });

            // Open clicked item if it wasn't active
            if (!isActive) {
                accordionItem.classList.add('active');
                this.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Form handling - every .js-contact-form on the site goes through here.
    document.querySelectorAll('.js-contact-form').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            const status = this.querySelector('.form-status');
            const setStatus = (message, kind) => {
                if (!status) return;
                status.textContent = message;
                status.className = 'form-status' + (kind ? ' is-' + kind : '');
            };

            // Validate by hand because the forms are novalidate, which lets us
            // mark fields with aria-invalid and move focus to the first problem
            // instead of relying on each browser's differently-styled bubbles.
            const invalid = Array.from(this.querySelectorAll('input, textarea, select'))
                .filter(field => {
                    const bad = !field.checkValidity();
                    field.setAttribute('aria-invalid', bad ? 'true' : 'false');
                    return bad;
                });

            if (invalid.length) {
                setStatus('Please complete the highlighted fields.', 'error');
                invalid[0].focus();
                return;
            }

            const data = Object.fromEntries(new FormData(this).entries());
            const subject = this.dataset.subject || 'Website enquiry';

            if (!FORM_ENDPOINT) {
                // No backend configured: hand the message to the visitor's mail
                // client so it still reaches the business. Silently reporting
                // success here would lose every lead.
                window.location.href = buildMailto(subject, data);
                setStatus('Your email app should open with your message ready to send.', 'success');
                return;
            }

            const submitButton = this.querySelector('button[type="submit"]');
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            submitButton.disabled = true;
            setStatus('');

            fetch(FORM_ENDPOINT, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body: new FormData(this)
            })
                .then(response => {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    this.reset();
                    setStatus('Thank you - your message has been sent. We’ll be in touch within one business day.', 'success');
                })
                .catch(() => {
                    setStatus('Something went wrong sending your message. Please email ' + CONTACT_EMAIL + ' or call 1-877-722-9268.', 'error');
                })
                .finally(() => {
                    submitButton.innerHTML = originalText;
                    submitButton.disabled = false;
                });
        });
    });

    // Schedule Demo page form -> /api/demo-request, which forwards it to a
    // Google Sheet plus an email notification. Falls back to mailto if that
    // fails, same safety net the generic .js-contact-form handler uses, so
    // a request is never silently lost.
    const scheduleDemoForm = document.getElementById('scheduleDemoForm');
    if (scheduleDemoForm) {
        const demoPhoneInput = document.getElementById('d-phone');
        const demoPhoneIti = setupPhoneInput(demoPhoneInput);

        scheduleDemoForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const status = this.querySelector('.form-status');
            const setStatus = (message, kind) => {
                if (!status) return;
                status.textContent = message;
                status.className = 'form-status' + (kind ? ' is-' + kind : '');
            };

            const invalid = Array.from(this.querySelectorAll('input, textarea, select'))
                .filter(field => {
                    const bad = !field.checkValidity();
                    field.setAttribute('aria-invalid', bad ? 'true' : 'false');
                    return bad;
                });

            if (invalid.length) {
                setStatus('Please complete the highlighted fields.', 'error');
                invalid[0].focus();
                return;
            }

            if (demoPhoneIti && !demoPhoneIti.isValidNumber()) {
                demoPhoneInput.setAttribute('aria-invalid', 'true');
                setStatus('Please enter a valid phone number for the selected country.', 'error');
                demoPhoneInput.focus();
                return;
            }
            demoPhoneInput.setAttribute('aria-invalid', 'false');

            const data = Object.fromEntries(new FormData(this).entries());
            if (demoPhoneIti) data.phone = demoPhoneIti.getNumber();
            const submitButton = this.querySelector('button[type="submit"]');
            const originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            submitButton.disabled = true;
            setStatus('');

            fetch('/api/demo-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
                .then(function(response) {
                    return response.json().then(function(body) {
                        if (!response.ok) throw new Error(body && body.error || 'HTTP ' + response.status);
                        return body;
                    });
                })
                .then(function() {
                    scheduleDemoForm.reset();
                    setStatus("Thank you - your demo request has been sent. We'll be in touch within one business day.", 'success');
                })
                .catch(function() {
                    window.location.href = buildMailto('Demo request', data);
                    setStatus('Your email app should open with your request ready to send.', 'success');
                })
                .finally(function() {
                    submitButton.innerHTML = originalText;
                    submitButton.disabled = false;
                });
        });
    }

    // Contact page "Chat with Us" widget. Talks to the /api/chat serverless
    // function, which proxies to Gemini so the API key never reaches the
    // browser. Only present on contact.html, so every lookup here is guarded.
    const chatCard = document.getElementById('chatCard');
    if (chatCard) {
        const startChatBtn = document.getElementById('startChatBtn');
        const chatWindow = document.getElementById('chatWindow');
        const chatIntro = document.getElementById('chatIntro');
        const chatLeadForm = document.getElementById('chatLeadForm');
        const chatLeadBack = document.getElementById('chatLeadBack');
        const chatLeadName = document.getElementById('chat-lead-name');
        const chatLeadEmail = document.getElementById('chat-lead-email');
        const chatLeadPhone = document.getElementById('chat-lead-phone');
        const chatLeadPhoneIti = setupPhoneInput(chatLeadPhone);
        const chatLeadStatus = document.getElementById('chatLeadStatus');
        const chatCloseBtn = document.getElementById('chatCloseBtn');
        const chatMessages = document.getElementById('chatMessages');
        const chatForm = document.getElementById('chatForm');
        const chatInput = document.getElementById('chatInput');
        const chatStatus = document.getElementById('chatStatus');

        const history = [];
        let sending = false;
        let lead = null;

        const addBubble = (text, kind) => {
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble ' + kind;
            bubble.textContent = text;
            chatMessages.appendChild(bubble);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return bubble;
        };

        const showTyping = () => {
            const typing = document.createElement('div');
            typing.className = 'chat-typing';
            typing.innerHTML = '<span></span><span></span><span></span>';
            chatMessages.appendChild(typing);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return typing;
        };

        startChatBtn.addEventListener('click', function() {
            chatIntro.hidden = true;
            chatLeadForm.hidden = false;
            chatLeadName.focus();
        });

        chatLeadBack.addEventListener('click', function() {
            chatLeadForm.hidden = true;
            chatIntro.hidden = false;
        });

        chatLeadForm.addEventListener('submit', function(e) {
            e.preventDefault();

            if (chatLeadStatus) chatLeadStatus.textContent = '';

            const invalid = Array.from(this.querySelectorAll('input'))
                .filter(field => {
                    const bad = !field.checkValidity();
                    field.setAttribute('aria-invalid', bad ? 'true' : 'false');
                    return bad;
                });

            if (invalid.length) {
                if (chatLeadStatus) chatLeadStatus.textContent = 'Please complete the highlighted fields.';
                invalid[0].focus();
                return;
            }

            if (chatLeadPhoneIti && !chatLeadPhoneIti.isValidNumber()) {
                chatLeadPhone.setAttribute('aria-invalid', 'true');
                if (chatLeadStatus) chatLeadStatus.textContent = 'Please enter a valid phone number for the selected country.';
                chatLeadPhone.focus();
                return;
            }
            chatLeadPhone.setAttribute('aria-invalid', 'false');

            lead = {
                name: chatLeadName.value.trim(),
                email: chatLeadEmail.value.trim(),
                phone: chatLeadPhoneIti ? chatLeadPhoneIti.getNumber() : chatLeadPhone.value.trim()
            };

            // Fire-and-forget: save the lead to the spreadsheet in the
            // background. The chat should open immediately regardless of
            // whether this succeeds - it's a supplementary record, not a
            // gate on talking to the assistant.
            fetch('/api/lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lead)
            }).catch(function() { /* logged server-side; nothing to show the visitor */ });

            chatLeadForm.hidden = true;
            chatWindow.hidden = false;

            const firstName = lead.name.split(' ')[0];
            addBubble('Hi ' + firstName + "! I'm the BayBot Dynamics assistant. Ask me anything about our robots, pricing, or support.", 'assistant');
            chatInput.focus();
        });

        chatCloseBtn.addEventListener('click', function() {
            chatWindow.hidden = true;
            chatIntro.hidden = false;
            chatMessages.innerHTML = '';
            history.length = 0;
            lead = null;
            chatLeadForm.reset();
            if (chatLeadStatus) chatLeadStatus.textContent = '';
        });

        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (sending) return;

            const message = chatInput.value.trim();
            if (!message) return;

            addBubble(message, 'user');
            chatInput.value = '';
            chatStatus.textContent = '';

            sending = true;
            chatInput.disabled = true;
            const typing = showTyping();

            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    history: history,
                    lead: history.length === 0 ? lead : undefined
                })
            })
                .then(function(response) {
                    return response.json().then(function(data) {
                        if (!response.ok) throw new Error(data && data.error || 'HTTP ' + response.status);
                        return data;
                    });
                })
                .then(function(data) {
                    typing.remove();
                    addBubble(data.reply, 'assistant');
                    history.push({ role: 'user', text: message });
                    history.push({ role: 'model', text: data.reply });
                })
                .catch(function() {
                    typing.remove();
                    chatStatus.textContent = 'The assistant is temporarily unavailable. Please email info@baybotdynamics.com or call 1-877-722-9268.';
                })
                .finally(function() {
                    sending = false;
                    chatInput.disabled = false;
                    chatInput.focus();
                });
        });
    }

    // Click-to-load YouTube embeds on product pages. Only a thumbnail loads
    // until play is pressed; the privacy-enhanced (no-cookie) player then
    // replaces it. Without JavaScript the poster stays a plain YouTube link.
    document.querySelectorAll('.video-embed').forEach(embed => {
        const poster = embed.querySelector('.video-embed-poster');
        const id = embed.dataset.videoId;
        if (!poster || !/^[A-Za-z0-9_-]{11}$/.test(id || '')) return;

        poster.addEventListener('click', function(e) {
            e.preventDefault();
            const iframe = document.createElement('iframe');
            iframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1';
            iframe.title = embed.dataset.title || 'Product video';
            iframe.setAttribute('frameborder', '0');
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.allowFullscreen = true;
            poster.replaceWith(iframe);
            iframe.focus();
        });
    });

    // Back to Top Button
    const backToTop = document.getElementById('backToTop');
    if (backToTop) {
        window.addEventListener('scroll', function() {
            if (window.pageYOffset > 500) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        });

        backToTop.addEventListener('click', function() {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // Smooth scroll for anchor links
    // The skip link is excluded: it must keep native behaviour so keyboard
    // focus actually moves into <main>, which preventDefault would stop.
    document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href !== '') {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    const offsetTop = target.offsetTop - 80; // Account for fixed navbar
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });

                    // Close mobile menu if open
                    if (navMenu.classList.contains('active')) {
                        mobileMenuToggle.classList.remove('active');
                        mobileMenuToggle.setAttribute('aria-expanded', 'false');
                        navMenu.classList.remove('active');
                    }
                }
            }
        });
    });

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements with fade-in class
    document.querySelectorAll('.industry-card, .feature-highlight').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Add loading state to all buttons with external links
    document.querySelectorAll('a.btn').forEach(button => {
        if (button.hostname !== window.location.hostname && !button.hasAttribute('target')) {
            button.addEventListener('click', function(e) {
                // Only add loading state for non-target links
                if (!this.hasAttribute('data-loading')) {
                    const icon = this.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-spinner fa-spin';
                    }
                    this.setAttribute('data-loading', 'true');
                }
            });
        }
    });

    // Lazy load images
    if ('loading' in HTMLImageElement.prototype) {
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => {
            img.src = img.dataset.src;
        });
    } else {
        // Fallback for browsers that don't support lazy loading
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lazysizes/5.3.2/lazysizes.min.js';
        document.body.appendChild(script);
    }

    // Performance optimization: Debounce scroll events
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Optimize scroll events
    const handleScroll = debounce(function() {
        // Any additional scroll-based animations can be added here
    }, 100);

    window.addEventListener('scroll', handleScroll);

    // Console log for development
    console.log('%c BayBot Dynamics Website Loaded Successfully ', 'background: #0066cc; color: #fff; padding: 10px; font-weight: bold; font-size: 14px;');
    console.log('%c Powered by Modern Web Technologies ', 'background: #00cc88; color: #fff; padding: 5px; font-size: 12px;');
});

// Preload critical images
window.addEventListener('load', function() {
    const criticalImages = [
        'assets/images/logo.png?v=2',
        'assets/images/pro/Bots-in-Field1.webp'
    ];

    criticalImages.forEach(src => {
        const img = new Image();
        img.src = src;
    });
});

// Handle browser back/forward button
window.addEventListener('popstate', function() {
    // Close mobile menu if open
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navMenu = document.getElementById('navMenu');
    
    if (navMenu && navMenu.classList.contains('active')) {
        mobileMenuToggle.classList.remove('active');
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
        navMenu.classList.remove('active');
    }
});

// Accessibility: Trap focus in mobile menu when open
document.addEventListener('keydown', function(e) {
    const navMenu = document.getElementById('navMenu');
    
    if (navMenu && navMenu.classList.contains('active') && e.key === 'Escape') {
        const mobileMenuToggle = document.getElementById('mobileMenuToggle');
        mobileMenuToggle.classList.remove('active');
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
        navMenu.classList.remove('active');
        mobileMenuToggle.focus();
    }
});