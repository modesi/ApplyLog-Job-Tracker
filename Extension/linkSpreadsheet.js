const CANONICAL_FIELD_ORDER = ['title', 'company', 'status', 'type', 'date', 'location', 'salary', 'deadline', 'link', 'notes'];

// Header text aliases used to auto-detect which old column is which field.
const IMPORT_FIELD_ALIASES = {
    title:    ['job title', 'title', 'position', 'role', 'job', 'job name'],
    company:  ['company', 'employer', 'organization', 'org', 'company name'],
    status:   ['status', 'application status', 'stage', 'application stage'],
    type:     ['type', 'job type', 'employment type'],
    date:     ['date added', 'date applied', 'date', 'applied date', 'application date', 'added'],
    location: ['location', 'city', 'job location', 'city state'],
    salary:   ['salary', 'pay', 'compensation', 'wage', 'salary range'],
    deadline: ['deadline', 'due date', 'application deadline', 'apply by'],
    link:     ['link', 'url', 'job link', 'posting link', 'job url', 'application link'],
    notes:    ['notes', 'note', 'comments', 'comment', 'description']
};

let pendingImport = null;
let chosenOldSheet = null; // { fileId, fileName } set once the user picks a file

// Hosted page that runs the Google Picker (can't run inside the popup itself -
// Manifest V3's CSP blocks loading https://apis.google.com/js/api.js in
// extension pages). See background.js for how the pick result gets back here.
const PICKER_URL = 'https://applylogtracker.com/picker.html';

document.addEventListener('DOMContentLoaded', () => {
    const importToggle = document.getElementById('importToggle');
    const importForm = document.getElementById('importForm');
    if (importToggle && importForm) {
        importToggle.addEventListener('click', () => {
            const isOpen = importForm.style.display !== 'none';
            importForm.style.display = isOpen ? 'none' : 'flex';
        });
    }

    const previewBtn = document.getElementById('previewImportBtn');
    if (previewBtn) {
        previewBtn.addEventListener('click', previewImport);
    }

    const chooseBtn = document.getElementById('chooseOldSheetBtn');
    if (chooseBtn) {
        chooseBtn.addEventListener('click', openOldSheetPicker);
    }

    // The picker runs in its own tab, and the popup closes the moment that tab
    // gets focus - so on every popup open, check whether background.js has a
    // pick result waiting for us in storage.
    checkForPendingOldSheetPick();
});

function checkForPendingOldSheetPick() {
    chrome.storage.local.get(['pendingOldSheetPick'], (result) => {
        const pick = result.pendingOldSheetPick;
        if (!pick || !pick.fileId) return;

        chrome.storage.local.remove('pendingOldSheetPick');
        setChosenOldSheet(pick.fileId, pick.fileName);

        // Reopen the import panel so the result is visible.
        const importForm = document.getElementById('importForm');
        if (importForm) importForm.style.display = 'flex';
    });
}

function setChosenOldSheet(fileId, fileName) {
    chosenOldSheet = { fileId, fileName };
    pendingImport = null;

    const nameEl = document.getElementById('oldSheetChosenName');
    if (nameEl) nameEl.textContent = fileName ? `Selected: ${fileName}` : 'Spreadsheet selected';

    const previewBtn = document.getElementById('previewImportBtn');
    if (previewBtn) previewBtn.disabled = false;

    const previewArea = document.getElementById('importPreviewArea');
    if (previewArea) previewArea.innerHTML = '';

    setFeedback(document.getElementById('importFeedback'), '', '');
}

function openOldSheetPicker() {
    const feedbackEl = document.getElementById('importFeedback');
    setFeedback(feedbackEl, 'Opening file picker…', '');

    requestAuthToken(true, (token, error) => {
        if (error || !token) {
            setFeedback(feedbackEl, 'Authentication failed. Try reconnecting.', 'error');
            return;
        }
        // Token goes in the URL fragment (not a query string) so it's never
        // sent to or logged by the server hosting picker.html.
        chrome.tabs.create({ url: `${PICKER_URL}#token=${encodeURIComponent(token)}` });
        setFeedback(feedbackEl, 'Choose a spreadsheet in the new tab, then come back here.', '');
    });
}

function normalizeHeader(h) {
    return (h || '').toString().toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Returns the canonical field name a header maps to, or null if unrecognized.
function detectField(header) {
    const norm = normalizeHeader(header);
    if (!norm) return null;
    for (const field of Object.keys(IMPORT_FIELD_ALIASES)) {
        for (const alias of IMPORT_FIELD_ALIASES[field]) {
            if (norm === alias || norm.includes(alias) || alias.includes(norm)) {
                return field;
            }
        }
    }
    return null;
}

// STEP 1: read the old spreadsheet and show the user how its columns will map.
function previewImport() {
    const feedbackEl = document.getElementById('importFeedback');
    const previewArea = document.getElementById('importPreviewArea');
    previewArea.innerHTML = '';
    pendingImport = null;

    if (!chosenOldSheet || !chosenOldSheet.fileId) {
        setFeedback(feedbackEl, 'Choose a spreadsheet first.', 'error');
        return;
    }
    const oldSpreadsheetId = chosenOldSheet.fileId;

    chrome.storage.sync.get(['spreadsheetId'], (result) => {
        if (!result.spreadsheetId) {
            setFeedback(feedbackEl, 'Connect Google Sheets first.', 'error');
            return;
        }
        if (oldSpreadsheetId === result.spreadsheetId) {
            setFeedback(feedbackEl, "That's already your connected ApplyLog spreadsheet.", 'error');
            return;
        }

        setFeedback(feedbackEl, 'Reading old spreadsheet…', '');

        requestAuthToken(true, (token, authError) => {
            if (authError || !token) {
                setFeedback(feedbackEl, 'Authentication failed. Try reconnecting.', 'error');
                return;
            }

            fetchOldSheetValues(oldSpreadsheetId, token, (error, sheetTitle, rows) => {
                if (error) {
                    console.error('Error reading old spreadsheet:', error);
                    setFeedback(feedbackEl, "❌ Couldn't read that spreadsheet. Check the link and that you have access to it.", 'error');
                    return;
                }

                if (!rows || rows.length === 0) {
                    setFeedback(feedbackEl, 'That spreadsheet looks empty.', 'error');
                    return;
                }

                const headers = rows[0];
                const dataRows = rows.slice(1).filter(row => row.some(cell => (cell || '').toString().trim() !== ''));

                if (dataRows.length === 0) {
                    setFeedback(feedbackEl, 'No data rows found under the header row.', 'error');
                    return;
                }

                // Map each old column to a canonical field. First match wins, so a
                // second column that looks like the same field is treated as extra
                // data instead of silently overwriting the first — nothing is lost.
                const usedFields = new Set();
                const columnMap = headers.map((header) => {
                    const field = detectField(header);
                    if (field && !usedFields.has(field)) {
                        usedFields.add(field);
                        return { header, field };
                    }
                    return { header, field: null };
                });

                pendingImport = { oldSpreadsheetId, sheetTitle, headers, columnMap, dataRows };

                renderImportPreview(columnMap, dataRows.length);
                setFeedback(feedbackEl, '', '');
            });
        });
    });
}

// Fetches the first sheet's title and full used range of values from the old spreadsheet.
// Works under the narrow drive.file scope because the user granted per-file
// access to this specific spreadsheet by selecting it in the Google Picker
// (see openOldSheetPicker / picker.html) - not because of a broad scope.
function fetchOldSheetValues(spreadsheetId, token, callback) {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;

    fetch(metaUrl, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(response => {
        if (!response.ok) return response.json().then(err => { throw new Error(JSON.stringify(err)); });
        return response.json();
    })
    .then(meta => {
        const firstSheet = meta.sheets && meta.sheets[0];
        if (!firstSheet) throw new Error('No sheets found in spreadsheet.');
        const sheetTitle = firstSheet.properties.title;

        const range = `'${sheetTitle}'!A1:ZZ5000`;
        const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;

        return fetch(valuesUrl, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(response => {
            if (!response.ok) return response.json().then(err => { throw new Error(JSON.stringify(err)); });
            return response.json();
        })
        .then(data => callback(null, sheetTitle, data.values || []));
    })
    .catch(error => callback(error));
}

function renderImportPreview(columnMap, rowCount) {
    const previewArea = document.getElementById('importPreviewArea');

    const mappedCount = columnMap.filter(c => c.field).length;
    const newColumnCount = columnMap.length - mappedCount;

    const rowsHtml = columnMap.map(({ header, field }) => {
        const label = header && header.toString().trim() ? header : '(untitled column)';
        if (field) {
            const targetLabel = SHEET_HEADERS[CANONICAL_FIELD_ORDER.indexOf(field)];
            return `
                <div class="import-map-row">
                    <span class="import-map-old">${escapeHtml(label)}</span>
                    <span class="import-map-arrow">→</span>
                    <span class="import-map-target matched">${escapeHtml(targetLabel)}</span>
                </div>`;
        }
        return `
            <div class="import-map-row">
                <span class="import-map-old">${escapeHtml(label)}</span>
                <span class="import-map-arrow">→</span>
                <span class="import-map-target new-column">new column</span>
            </div>`;
    }).join('');

    previewArea.innerHTML = `
        <div class="import-summary">${rowCount} job(s) found · ${mappedCount} column(s) matched automatically · ${newColumnCount} new column(s) will be added so nothing is lost</div>
        <div class="import-mapping">${rowsHtml}</div>
        <button type="button" class="btn-connect btn-import-confirm" id="confirmImportBtn">Import ${rowCount} Job${rowCount === 1 ? '' : 's'}</button>
    `;

    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
}

// STEP 2: write the mapped (and preserved-extra) data into the ApplyLog sheet.
function confirmImport() {
    const feedbackEl = document.getElementById('importFeedback');
    if (!pendingImport) {
        setFeedback(feedbackEl, 'Preview the import first.', 'error');
        return;
    }

    chrome.storage.sync.get(['spreadsheetId', 'sheetGid'], (result) => {
        const newSpreadsheetId = result.spreadsheetId;
        const gid = result.sheetGid;
        if (!newSpreadsheetId) {
            setFeedback(feedbackEl, 'Connect Google Sheets first.', 'error');
            return;
        }

        setFeedback(feedbackEl, 'Importing…', '');

        requestAuthToken(true, (token, authError) => {
            if (authError || !token) {
                setFeedback(feedbackEl, 'Authentication failed. Try reconnecting.', 'error');
                return;
            }

            // Read the destination sheet's current header row first — it may already
            // have extra columns from a previous import that should be reused rather
            // than duplicated.
            const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/Sheet1!1:1`;
            fetch(headerUrl, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(response => response.json())
            .then(data => {
                const currentHeaders = (data.values && data.values[0]) ? data.values[0].slice() : SHEET_HEADERS.slice();

                const extraColumnIndex = {}; // normalized header text -> column index
                currentHeaders.forEach((h, i) => {
                    if (i >= CANONICAL_FIELD_ORDER.length) {
                        extraColumnIndex[normalizeHeader(h)] = i;
                    }
                });

                const newHeaders = currentHeaders.slice();
                pendingImport.columnMap.forEach((col) => {
                    if (col.field) return; // canonical fields already have a fixed slot
                    const key = normalizeHeader(col.header) || `column ${newHeaders.length + 1}`;
                    if (extraColumnIndex[key] === undefined) {
                        extraColumnIndex[key] = newHeaders.length;
                        newHeaders.push(col.header && col.header.toString().trim() ? col.header : `Imported Column ${newHeaders.length}`);
                    }
                    col.targetIndex = extraColumnIndex[key];
                });

                const headerChanged = newHeaders.length !== currentHeaders.length;

                writeHeadersIfNeeded(newSpreadsheetId, token, newHeaders, headerChanged, (error) => {
                    if (error) {
                        console.error('Error extending headers:', error);
                        setFeedback(feedbackEl, "❌ Couldn't add new columns — see console.", 'error');
                        return;
                    }

                    // Build one full-width row per old data row.
                    const rowsToAppend = pendingImport.dataRows.map((oldRow) => {
                        const row = new Array(newHeaders.length).fill('');
                        pendingImport.columnMap.forEach((col, colIndex) => {
                            const value = oldRow[colIndex] || '';
                            if (!value) return;
                            const cellValue = (col.field === 'link' && typeof buildLinkCellValue === 'function')
                                ? buildLinkCellValue(value)
                                : value;
                            if (col.field) {
                                row[CANONICAL_FIELD_ORDER.indexOf(col.field)] = cellValue;
                            } else {
                                row[col.targetIndex] = cellValue;
                            }
                        });
                        return row;
                    });

                    appendImportedRows(newSpreadsheetId, token, rowsToAppend, (err, updatedRange) => {
                        if (err) {
                            console.error('Error importing rows:', err);
                            setFeedback(feedbackEl, '❌ Import failed partway — see console. Already-added columns are safe.', 'error');
                            return;
                        }

                        const finishImport = () => {
                            const addedCols = newHeaders.length - currentHeaders.length;
                            const summary = addedCols > 0
                                ? `✅ Imported ${rowsToAppend.length} job(s) — added ${addedCols} new column(s) to keep everything.`
                                : `✅ Imported ${rowsToAppend.length} job(s).`;
                            setFeedback(feedbackEl, summary, 'success');
                            document.getElementById('importPreviewArea').innerHTML = '';
                            const nameEl = document.getElementById('oldSheetChosenName');
                            if (nameEl) nameEl.textContent = '';
                            const previewBtn = document.getElementById('previewImportBtn');
                            if (previewBtn) previewBtn.disabled = true;
                            chosenOldSheet = null;
                            pendingImport = null;
                            if (typeof loadJobsFromSheet === 'function') loadJobsFromSheet();
                        };

                        // Same INSERT_ROWS quirk as manual entries: imported rows can inherit
                        // formatting (including the black header) from the row above them.
                        if (updatedRange && gid !== undefined && gid !== null && typeof resetAppendedRowFormatting === 'function') {
                            resetAppendedRowFormatting(newSpreadsheetId, gid, token, updatedRange, newHeaders.length, finishImport);
                        } else {
                            finishImport();
                        }
                    });
                });
            })
            .catch(error => {
                console.error('Error reading destination headers:', error);
                setFeedback(feedbackEl, "❌ Couldn't read your spreadsheet — see console.", 'error');
            });
        });
    });
}

function writeHeadersIfNeeded(spreadsheetId, token, newHeaders, headerChanged, callback) {
    if (!headerChanged) { callback(null); return; }

    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!1:1?valueInputOption=USER_ENTERED`;
    fetch(updateUrl, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [newHeaders] })
    })
    .then(response => {
        if (!response.ok) return response.json().then(err => { throw new Error(JSON.stringify(err)); });
        return response.json();
    })
    .then(() => callback(null))
    .catch(error => callback(error));
}

function appendImportedRows(spreadsheetId, token, rows, callback) {
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    fetch(appendUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows })
    })
    .then(response => {
        if (!response.ok) return response.json().then(err => { throw new Error(JSON.stringify(err)); });
        return response.json();
    })
    .then(data => callback(null, data.updates && data.updates.updatedRange))
    .catch(error => callback(error));
}