document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll('.tab').forEach(tabBtn => {
          tabBtn.addEventListener('click', () => switchToTab(tabBtn.getAttribute('data-tab')));
      });

      const clearBtn = document.getElementById("clearBtn");
      if (clearBtn) {
          clearBtn.addEventListener("click", clearActiveTabJobs);
      }

      const searchInput = document.getElementById("jobSearchInput");
      if (searchInput) {
          searchInput.addEventListener("input", () => {
              currentSearchQuery = searchInput.value;
              applyFilterAndRender();
          });
      }
    });

    let allJobsCache = [];
    let currentSearchQuery = '';

    const TABS = ['applied', 'saved', 'progress'];

    function switchToTab(tabName) {
        TABS.forEach(name => {
            const isActive = name === tabName;
            document.getElementById(`${name}-content`).classList.toggle('active', isActive);
            document.querySelector(`.tab[data-tab="${name}"]`).classList.toggle('active', isActive);
        });
        updateClearButtonLabel();
    }

    function updateClearButtonLabel() {
        const clearBtn = document.getElementById("clearBtn");
        if (!clearBtn) return;
        const labels = { applied: 'Clear Applied', saved: 'Clear Saved', progress: 'Clear Progress' };
        clearBtn.textContent = `${labels[getActiveTab()] || 'Clear'}`;
    }

    const SHEET_COLUMNS = ['title', 'company', 'status', 'type', 'date', 'location', 'salary', 'deadline', 'link', 'notes'];

    function tabForStatus(status) {
        const s = (status || '').toLowerCase();
        if (s === 'saved') return 'saved';
        if (s === 'applied') return 'applied';
        return 'progress';
    }

    function loadJobsFromSheet() {
        chrome.storage.sync.get(['spreadsheetId'], (result) => {
            if (!result.spreadsheetId) return;

            requestAuthToken(false, (token, error) => {
                if (error || !token) return;

                const range = 'Sheet1!A2:J';
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}/values/${range}`;

                fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(response => response.json())
                .then(data => {
                    const rows = data.values || [];
                    const jobs = rows
                        .map((row, i) => {
                            const job = { sheetRow: i + 2 };
                            SHEET_COLUMNS.forEach((key, colIndex) => { job[key] = row[colIndex] || ''; });
                            return job;
                        })
                        .filter(job => job.title);

                    allJobsCache = jobs;
                    applyFilterAndRender();
                })
                .catch(error => console.error('Error loading jobs from sheet:', error));
            });
        });
    }

    function applyFilterAndRender() {
        const query = currentSearchQuery.trim().toLowerCase();
        const filtered = !query ? allJobsCache : allJobsCache.filter(job =>
            (job.title || '').toLowerCase().includes(query) ||
            (job.company || '').toLowerCase().includes(query)
        );

        const applied = filtered.filter(j => tabForStatus(j.status) === 'applied');
        const saved = filtered.filter(j => tabForStatus(j.status) === 'saved');
        const inProgress = filtered.filter(j => tabForStatus(j.status) === 'progress');

        updateStatsCounts(allJobsCache);

        const noMatchSub = 'No jobs match your search.';
        renderJobList('appliedJobs', applied, 'applied',
            query ? 'No matches found' : 'No applied jobs yet',
            query ? noMatchSub : 'When you apply to a job on Handshake, click "Yes" to track it here.');
        renderJobList('savedJobs', saved, 'saved',
            query ? 'No matches found' : 'No saved jobs yet',
            query ? noMatchSub : 'Save jobs on Handshake to track them here.');
        renderJobList('progressJobs', inProgress, 'progress',
            query ? 'No matches found' : 'No jobs in progress',
            query ? noMatchSub : 'Interviewing, offer, and rejected jobs will show up here.');
    }

    function resetJobLists() {
        allJobsCache = [];
        currentSearchQuery = '';
        const searchInput = document.getElementById('jobSearchInput');
        if (searchInput) searchInput.value = '';
        renderJobList('appliedJobs', [], 'applied', 'No applied jobs yet', 'When you apply to a job on Handshake, click "Yes" to track it here.');
        renderJobList('savedJobs', [], 'saved', 'No saved jobs yet', 'Save jobs on Handshake to track them here.');
        renderJobList('progressJobs', [], 'progress', 'No jobs in progress', 'Interviewing, offer, and rejected jobs will show up here.');
        updateStatsCounts([]);
    }

    function updateStatsCounts(jobs) {
        const counts = {
            applied: jobs.filter(j => tabForStatus(j.status) === 'applied').length,
            saved: jobs.filter(j => tabForStatus(j.status) === 'saved').length,
            progress: jobs.filter(j => tabForStatus(j.status) === 'progress').length
        };

        [
            ['statAppliedCount', 'statCardApplied', counts.applied],
            ['statSavedCount', 'statCardSaved', counts.saved],
            ['statProgressCount', 'statCardProgress', counts.progress]
        ].forEach(([numId, cardId, value]) => {
            const numEl = document.getElementById(numId);
            const cardEl = document.getElementById(cardId);
            if (!numEl) return;
            const changed = numEl.textContent !== String(value);
            numEl.textContent = value;
            if (changed && cardEl) {
                cardEl.classList.remove('bump');
                void cardEl.offsetWidth;
                cardEl.classList.add('bump');
            }
        });
    }

    function renderJobList(containerId, jobs, listType, emptyTitle, emptySubtext) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (jobs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${escapeHtml(emptyTitle)}</p>
                    <small>${escapeHtml(emptySubtext)}</small>
                </div>
            `;
            return;
        }

        const listHtml = jobs.map(job => `
            <div class="job-card" data-row="${job.sheetRow}">
                <div class="job-card-top">
                    <div class="job-title">${escapeHtml(job.title)}</div>
                    <div class="job-card-buttons">
                        <button class="job-edit-btn" data-row="${job.sheetRow}" title="Edit">✏️</button>
                        <button class="job-delete-btn" data-row="${job.sheetRow}" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="job-company">${escapeHtml(job.company)}</div>
                <div class="job-edit-container" id="edit-container-${job.sheetRow}"></div>
            </div>
        `).join('');

        container.innerHTML = `<div class="jobs-list">${listHtml}</div>`;

        container.querySelectorAll('.job-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = parseInt(btn.getAttribute('data-row'), 10);
                showConfirmModal({
                    title: 'Delete this job?',
                    message: 'This removes it from your spreadsheet too.',
                    confirmLabel: 'Delete',
                    onConfirm: () => deleteJobRow(row)
                });
            });
        });

        container.querySelectorAll('.job-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = parseInt(btn.getAttribute('data-row'), 10);
                toggleEditForm(row);
            });
        });
    }

    // Escape user-supplied text before dropping it into innerHTML
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // Escape user-supplied text for safe use inside an HTML attribute (e.g. value="...")
    function escapeAttr(str) {
        return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function buildEditForm(job) {
        const statusOptions = ['Applied', 'Saved', 'Interviewing', 'Offer', 'Rejected'];
        const typeOptions = ['Internship', 'Full-Time', 'Part-Time'];

        const statusSelectHtml = statusOptions
            .map(opt => `<option value="${opt}" ${job.status === opt ? 'selected' : ''}>${opt}</option>`)
            .join('');
        const typeSelectHtml = typeOptions
            .map(opt => `<option value="${opt}" ${job.type === opt ? 'selected' : ''}>${opt}</option>`)
            .join('');

        return `
            <div class="manual-entry-form job-edit-form">
                <input type="text" class="form-input edit-title" placeholder="Job title" value="${escapeAttr(job.title)}">
                <input type="text" class="form-input edit-company" placeholder="Company" value="${escapeAttr(job.company)}">
                <div class="form-row">
                    <select class="form-input edit-status">${statusSelectHtml}</select>
                    <select class="form-input edit-type">${typeSelectHtml}</select>
                </div>
                <div class="form-row">
                    <input type="text" class="form-input edit-location" placeholder="Location" value="${escapeAttr(job.location)}">
                    <input type="text" class="form-input edit-salary" placeholder="Salary (optional)" value="${escapeAttr(job.salary)}">
                </div>
                <div class="form-row">
                    <div class="field-with-label">
                        <label class="field-label">Deadline</label>
                        <input type="date" class="form-input edit-deadline" value="${escapeAttr(job.deadline)}">
                    </div>
                    <input type="url" class="form-input edit-link" placeholder="Link (optional)" value="${escapeAttr(job.link)}">
                </div>
                <textarea class="form-input edit-notes" placeholder="Notes (optional)" rows="2">${escapeHtml(job.notes)}</textarea>
                <div class="form-row">
                    <button type="button" class="btn-ghost btn-edit-cancel">Cancel</button>
                    <button type="button" class="btn-connect btn-edit-save">Save</button>
                </div>
                <div class="manual-feedback edit-feedback"></div>
            </div>
        `;
    }

    function toggleEditForm(row) {
        const editContainer = document.getElementById(`edit-container-${row}`);
        if (!editContainer) return;

        const wasOpen = editContainer.classList.contains('open');

        document.querySelectorAll('.job-edit-container.open').forEach(el => {
            el.classList.remove('open');
            el.innerHTML = '';
        });

        if (wasOpen) return;

        const job = allJobsCache.find(j => j.sheetRow === row);
        if (!job) return;

        editContainer.innerHTML = buildEditForm(job);
        editContainer.classList.add('open');

        const titleInput = editContainer.querySelector('.edit-title');
        if (titleInput) titleInput.focus();

        editContainer.querySelector('.btn-edit-cancel').addEventListener('click', (e) => {
            e.stopPropagation();
            editContainer.classList.remove('open');
            editContainer.innerHTML = '';
        });

        editContainer.querySelector('.btn-edit-save').addEventListener('click', (e) => {
            e.stopPropagation();
            submitJobEdit(row, editContainer, job);
        });
    }

    // Gather the edit form's values, validate, and push them to the sheet
    function submitJobEdit(row, editContainer, originalJob) {
        const feedbackEl = editContainer.querySelector('.edit-feedback');

        const title = editContainer.querySelector('.edit-title').value.trim();
        const company = editContainer.querySelector('.edit-company').value.trim();
        const status = editContainer.querySelector('.edit-status').value;
        const type = editContainer.querySelector('.edit-type').value;
        const location = editContainer.querySelector('.edit-location').value.trim();
        const salary = editContainer.querySelector('.edit-salary').value.trim();
        const deadline = editContainer.querySelector('.edit-deadline').value;
        const link = editContainer.querySelector('.edit-link').value.trim();
        const notes = editContainer.querySelector('.edit-notes').value.trim();

        if (!title || !company) {
            setFeedback(feedbackEl, 'Job title and company are required.', 'error');
            return;
        }

        setFeedback(feedbackEl, 'Saving…', '');

        if (status === 'Applied' && originalJob.status !== 'Applied' && typeof triggerConfetti === 'function') {
            triggerConfetti();
        }

        const updatedRow = [title, company, status, type, originalJob.date, location, salary, deadline, link, notes];
        updateJobRow(row, updatedRow, feedbackEl);
    }

    // Overwrite an entire row (A:J) in the sheet with new values, then reload
    function updateJobRow(sheetRow, rowValues, feedbackEl) {
        chrome.storage.sync.get(['spreadsheetId'], (result) => {
            if (!result.spreadsheetId) return;

            requestAuthToken(true, (token, error) => {
                if (error || !token) {
                    console.error('Auth error:', error);
                    if (feedbackEl) setFeedback(feedbackEl, 'Authentication failed. Try reconnecting.', 'error');
                    return;
                }

                const url = `https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}/values/Sheet1!A${sheetRow}:J${sheetRow}?valueInputOption=USER_ENTERED`;
                fetch(url, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ values: [rowValues] })
                })
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(err => { throw new Error(JSON.stringify(err)); });
                    }
                    return response.json();
                })
                .then(() => loadJobsFromSheet())
                .catch(error => {
                    console.error('Error updating row:', error);
                    if (feedbackEl) setFeedback(feedbackEl, '❌ Failed to save — see console.', 'error');
                });
            });
        });
    }

    function deleteJobRow(sheetRow) {
        chrome.storage.sync.get(['spreadsheetId'], (result) => {
            if (!result.spreadsheetId) return;

            requestAuthToken(true, (token, error) => {
                if (error || !token) {
                    console.error('Auth error:', error);
                    return;
                }

                getSheetGid(result.spreadsheetId, token, (gid) => {
                    if (gid === null) {
                        console.error('Could not determine sheet ID for deletion.');
                        return;
                    }

                    const url = `https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}:batchUpdate`;
                    fetch(url, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            requests: [{
                                deleteDimension: {
                                    range: {
                                        sheetId: gid,
                                        dimension: 'ROWS',
                                        startIndex: sheetRow - 1, // 0-indexed
                                        endIndex: sheetRow
                                    }
                                }
                            }]
                        })
                    })
                    .then(response => {
                        if (!response.ok) {
                            return response.json().then(err => { throw new Error(JSON.stringify(err)); });
                        }
                        return response.json();
                    })
                    .then(() => loadJobsFromSheet())
                    .catch(error => console.error('Error deleting row:', error));
                });
            });
        });
    }

    // Get the numeric grid ID of "Sheet1" (needed for row deletion), caching it locally
    function getSheetGid(spreadsheetId, token, callback) {
        chrome.storage.sync.get(['sheetGid'], (result) => {
            if (result.sheetGid !== undefined && result.sheetGid !== null) {
                callback(result.sheetGid);
                return;
            }

            const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
            fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(response => response.json())
            .then(data => {
                const sheet = (data.sheets || []).find(s => s.properties.title === 'Sheet1') || (data.sheets || [])[0];
                const gid = sheet ? sheet.properties.sheetId : null;
                if (gid !== null) {
                    chrome.storage.sync.set({ sheetGid: gid });
                }
                callback(gid);
            })
            .catch(error => {
                console.error('Error fetching sheet ID:', error);
                callback(null);
            });
        });
    }

    function getActiveTab() {
        const activeTabBtn = document.querySelector('.tab.active');
        return activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'applied';
    }

    function clearActiveTabJobs() {
        const activeTab = getActiveTab();

        chrome.storage.sync.get(['spreadsheetId'], (result) => {
            if (!result.spreadsheetId) return;

            requestAuthToken(true, (token, error) => {
                if (error || !token) {
                    console.error('Auth error:', error);
                    return;
                }

                const range = 'Sheet1!A2:J';
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}/values/${range}`;

                fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(response => response.json())
                .then(data => {
                    const rows = data.values || [];
                    const jobs = rows
                        .map((row, i) => {
                            const job = { sheetRow: i + 2 };
                            SHEET_COLUMNS.forEach((key, colIndex) => { job[key] = row[colIndex] || ''; });
                            return job;
                        })
                        .filter(job => job.title);

                    const matching = jobs.filter(j => tabForStatus(j.status) === activeTab);

                    const tabDisplayNames = { applied: 'applied', saved: 'saved', progress: 'in-progress' };
                    const tabLabel = tabDisplayNames[activeTab] || activeTab;

                    if (matching.length === 0) {
                        showInfoModal('Nothing to clear', `No ${tabLabel} jobs to clear.`);
                        return;
                    }

                    showConfirmModal({
                        title: 'Clear all?',
                        message: `Delete all ${matching.length} ${tabLabel} job(s)? This removes them from your spreadsheet too.`,
                        confirmLabel: 'Delete All',
                        onConfirm: () => {
                            getSheetGid(result.spreadsheetId, token, (gid) => {
                                if (gid === null) {
                                    console.error('Could not determine sheet ID for clearing.');
                                    return;
                                }

                                // Delete highest row number first so earlier deletions don't shift later indices
                                const rowNumbers = matching.map(j => j.sheetRow).sort((a, b) => b - a);
                                const requests = rowNumbers.map(rowNum => ({
                                    deleteDimension: {
                                        range: {
                                            sheetId: gid,
                                            dimension: 'ROWS',
                                            startIndex: rowNum - 1,
                                            endIndex: rowNum
                                        }
                                    }
                                }));

                                const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${result.spreadsheetId}:batchUpdate`;
                                fetch(batchUrl, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ requests })
                                })
                                .then(response => {
                                    if (!response.ok) {
                                        return response.json().then(err => { throw new Error(JSON.stringify(err)); });
                                    }
                                    return response.json();
                                })
                                .then(() => loadJobsFromSheet())
                                .catch(error => console.error('Error clearing jobs:', error));
                            });
                        }
                    });
                })
                .catch(error => console.error('Error loading jobs to clear:', error));
            });
        });
    }