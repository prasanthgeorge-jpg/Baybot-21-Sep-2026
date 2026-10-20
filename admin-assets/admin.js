// Admin screens: add/remove rows, image previews, delete confirmation and the
// Cloudflare robot check on the login form. No inline scripts (the admin pages
// send a strict Content-Security-Policy).
(function () {
    'use strict';

    // Add a row from a <template>
    document.querySelectorAll('[data-add-row]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var kind = btn.getAttribute('data-add-row');
            var tpl = document.getElementById('tpl-' + kind);
            var holder = document.querySelector('[data-rows="' + kind + '"]');
            if (!tpl || !holder) return;
            holder.appendChild(tpl.content.cloneNode(true));
            var inputs = holder.querySelectorAll('[data-row]');
            var last = inputs[inputs.length - 1];
            var first = last && last.querySelector('input, textarea');
            if (first) first.focus();
        });
    });

    // Remove a row (keep one empty row so the section never disappears)
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-remove-row]');
        if (!btn) return;
        var row = btn.closest('[data-row]');
        var holder = row && row.parentNode;
        if (!row || !holder) return;
        if (holder.querySelectorAll('[data-row]').length > 1) row.remove();
        else row.querySelectorAll('input, textarea').forEach(function (f) { f.value = ''; });
    });

    // Preview a newly chosen main photo
    document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
        input.addEventListener('change', function () {
            var target = document.getElementById(input.getAttribute('data-preview'));
            var file = input.files && input.files[0];
            if (!target || !file) return;
            var img = document.createElement('img');
            img.alt = 'Selected photo';
            img.src = URL.createObjectURL(file);
            target.textContent = '';
            target.appendChild(img);
        });
    });

    // Character counter for the short summary
    document.querySelectorAll('textarea[data-count]').forEach(function (area) {
        var note = document.createElement('span');
        note.className = 'admin-muted';
        area.parentNode.appendChild(note);
        function update() { note.textContent = ' ' + area.value.length + ' of ' + area.maxLength + ' characters'; }
        area.addEventListener('input', update);
        update();
    });

    // Confirm before deleting
    document.querySelectorAll('form[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (e) {
            if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
        });
    });

    // Robot check on the login form
    var box = document.querySelector('.cf-box[data-sitekey]');
    if (box) {
        var form = box.closest('form');
        var submit = form.querySelector('[data-needs-captcha]');
        if (submit) submit.disabled = true;
        var tag = document.createElement('script');
        tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        tag.async = true;
        tag.onload = function () {
            window.turnstile.render(box, {
                sitekey: box.getAttribute('data-sitekey'),
                theme: 'light',
                callback: function () { if (submit) submit.disabled = false; },
                'expired-callback': function () { if (submit) submit.disabled = true; },
                'error-callback': function () { if (submit) submit.disabled = true; }
            });
        };
        tag.onerror = function () { box.textContent = 'The robot check could not load. Refresh the page.'; };
        document.head.appendChild(tag);
    }
}());
