(function () {
    const DRAFT_STORAGE_KEY = 'jobFormDraft';
    const SAVE_DEBOUNCE_MS = 250;

    // Keep this in sync with the fields inside #manualEntryForm in index.html
    const DRAFT_FIELD_IDS = [
        'jobTitleInput',
        'companyInput',
        'statusInput',
        'typeInput',
        'locationInput',
        'salaryInput',
        'deadlineInput',
        'linkInput',
        'notesInput'
    ];

    let saveTimeout = null;

    function getForm() {
        return document.getElementById('manualEntryForm');
    }

    function getFieldElements() {
        return DRAFT_FIELD_IDS
            .map((id) => document.getElementById(id))
            .filter(Boolean);
    }

    function readFormIntoDraft() {
        const draft = {};
        getFieldElements().forEach((el) => {
            draft[el.id] = el.value;
        });
        return draft;
    }

    function draftHasContent(draft) {
        return Object.values(draft).some((value) => (value || '').trim() !== '');
    }

    function saveDraftNow() {
        const draft = readFormIntoDraft();
        if (draftHasContent(draft)) {
            chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: draft });
        } else {
            chrome.storage.local.remove(DRAFT_STORAGE_KEY);
        }
    }

    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveDraftNow, SAVE_DEBOUNCE_MS);
    }

    function clearDraft() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        chrome.storage.local.remove(DRAFT_STORAGE_KEY);
    }

    function applyDraftToForm(draft) {
        if (!draft) return;
        getFieldElements().forEach((el) => {
            if (Object.prototype.hasOwnProperty.call(draft, el.id) && draft[el.id]) {
                el.value = draft[el.id];
            }
        });
    }

    let pendingRestoredBanner = false;

    function showRestoredBanner() {
        const feedbackEl = document.getElementById('manualFeedback');
        if (feedbackEl) {
            feedbackEl.textContent = 'Restored your unsaved entry.';
            feedbackEl.className = 'manual-feedback';
        }
    }

    function restoreDraftIfAny() {
        chrome.storage.local.get([DRAFT_STORAGE_KEY], (result) => {
            const draft = result[DRAFT_STORAGE_KEY];
            if (!draft || !draftHasContent(draft)) return;

            const form = getForm();
            if (!form) return;

            applyDraftToForm(draft);
            pendingRestoredBanner = true;
        });
    }

    function collapseForm() {
        const form = getForm();
        if (form) form.style.display = 'none';
    }

    document.addEventListener('DOMContentLoaded', () => {
        const form = getForm();
        if (!form) return;

        restoreDraftIfAny();

        // Save on every change while the user is typing
        getFieldElements().forEach((el) => {
            el.addEventListener('input', scheduleSave);
            el.addEventListener('change', scheduleSave);
        });

        form.addEventListener('reset', clearDraft);


        const manualToggle = document.getElementById('manualEntryToggle');
        if (manualToggle) {
            manualToggle.addEventListener('click', () => {

                const isNowOpen = form.style.display !== 'none';
                if (isNowOpen && pendingRestoredBanner) {
                    showRestoredBanner();
                    pendingRestoredBanner = false;
                }
            });
        }

        window.addEventListener('pagehide', saveDraftNow);
        window.addEventListener('blur', () => {
            saveDraftNow();
            collapseForm();
        });
    });
})();