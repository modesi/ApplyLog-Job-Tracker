const SHEET_HEADERS = ['Job Title', 'Company', 'Status', 'Type', 'Date Added', 'Location', 'Salary', 'Deadline', 'Link', 'Notes'];
const STATUS_OPTIONS = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Rejected'];
const TYPE_OPTIONS = ['Internship', 'Full-Time', 'Part-Time'];

function buildLinkCellValue(url) {
    const trimmed = (url || '').toString().trim();
    if (!trimmed) return '';
    const escaped = trimmed.replace(/"/g, '""');
    return `=HYPERLINK("${escaped}","Open ↗")`;
}


function requestAuthToken(interactive, callback) {
    chrome.runtime.sendMessage({ type: 'getAuthToken', interactive: !!interactive }, (response) => {
        if (chrome.runtime.lastError) {
            callback(null, chrome.runtime.lastError.message);
            return;
        }
        if (!response || response.error) {
            callback(null, response ? response.error : 'No response from background script');
            return;
        }
        callback(response.token, null);
    });
}

const SPREADSHEET_STYLE_VERSION = 3;

// Style (or re-style) a spreadsheet if it isn't already on the current look.
// Handles both brand-new sheets and ones that were created before a style update.
function ensureSpreadsheetStyled(spreadsheetId, oauthToken, onDone) {
    chrome.storage.sync.get(['sheetGid', 'styleVersion'], (result) => {
        if (result.styleVersion === SPREADSHEET_STYLE_VERSION && result.sheetGid !== undefined && result.sheetGid !== null) {
            onDone();
            return;
        }

        const applyWithGid = (gid) => {
            styleSpreadsheet(spreadsheetId, gid, oauthToken, () => {
                chrome.storage.sync.set({ sheetGid: gid, styleVersion: SPREADSHEET_STYLE_VERSION }, onDone);
            });
        };

        if (result.sheetGid !== undefined && result.sheetGid !== null) {
            applyWithGid(result.sheetGid);
            return;
        }

        // No cached gid (e.g. an older/reused spreadsheet) - look up the first sheet's gid
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
            headers: { 'Authorization': `Bearer ${oauthToken}` }
        })
        .then(response => response.json())
        .then(meta => {
            const firstSheet = meta.sheets && meta.sheets[0];
            if (!firstSheet) { onDone(); return; }
            applyWithGid(firstSheet.properties.sheetId);
        })
        .catch(error => {
            console.error('Error looking up sheet gid for styling:', error);
            onDone();
        });
    });
}

function triggerConfetti() {
    const existing = document.getElementById('confettiCanvas');
    if (existing) existing.remove();

    const canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '2000';
    canvas.width = document.documentElement.clientWidth || window.innerWidth;
    canvas.height = document.documentElement.clientHeight || window.innerHeight;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    const colors = ['#e21833', '#4A6FA5', '#16a34a', '#ad7231', '#2D3748'];
    const particleCount = 90;
    const particles = Array.from({ length: particleCount }, () => ({
        x: canvas.width / 2 + (Math.random() - 0.5) * 50,
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -7 - 3,
        size: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        gravity: 0.28 + Math.random() * 0.08
    }));

    const duration = 900;
    const start = performance.now();

    function frame(now) {
        const elapsed = now - start;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.rotation += p.vr;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        });

        if (elapsed < duration) {
            requestAnimationFrame(frame);
        } else {
            canvas.remove();
        }
    }
    requestAnimationFrame(frame);
}

document.addEventListener("DOMContentLoaded", function() {
    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) {
        connectBtn.addEventListener("click", () => {
            console.log("Connect button clicked");
            authenticateUser();
        });
    } else {
        console.error('Connect button not found');
    }

    checkConnectionStatus();

    const manualToggle = document.getElementById("manualEntryToggle");
    const manualForm = document.getElementById("manualEntryForm");
    if (manualToggle && manualForm) {
        manualToggle.addEventListener("click", () => {
            const isOpen = manualForm.style.display !== "none";
            manualForm.style.display = isOpen ? "none" : "flex";
        });
        manualForm.addEventListener("submit", addManualEntry);
    }

    const disconnectBtn = document.getElementById("disconnectBtn");
    if (disconnectBtn) {
        disconnectBtn.addEventListener("click", () => {
            showConfirmModal({
                title: 'Disconnect Google Sheets?',
                message: "You'll need to reconnect (and can choose a different account) to sync again.",
                confirmLabel: 'Disconnect',
                onConfirm: disconnectAccount
            });
        });
    }
});

function showConfirmModal({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', showCancel = true, onConfirm }) {
    const overlay = document.getElementById('confirmModalOverlay');
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const confirmBtn = document.getElementById('confirmModalConfirm');
    const cancelBtn = document.getElementById('confirmModalCancel');

    if (!overlay || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        if (!showCancel) { alert(message || title); if (onConfirm) onConfirm(); return; }
        if (confirm(message || title) && onConfirm) onConfirm();
        return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmLabel;
    cancelBtn.style.display = showCancel ? '' : 'none';
    overlay.style.display = 'flex';

    const cleanup = () => {
        overlay.style.display = 'none';
        cancelBtn.style.display = '';
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleOverlayClick);
        document.removeEventListener('keydown', handleKeydown);
    };
    const handleConfirm = () => { cleanup(); if (onConfirm) onConfirm(); };
    const handleCancel = () => cleanup();
    const handleOverlayClick = (e) => { if (e.target === overlay) cleanup(); };
    const handleKeydown = (e) => { if (e.key === 'Escape') cleanup(); };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);
}

function showInfoModal(title, message, okLabel = 'OK') {
    showConfirmModal({ title, message, confirmLabel: okLabel, showCancel: false, onConfirm: () => {} });
}

// Check on popup open whether we already have a stored spreadsheet + valid token
function checkConnectionStatus() {
    chrome.storage.sync.get(['spreadsheetId'], (result) => {
        if (result.spreadsheetId) {
            // Try to get a token silently (no popup) to confirm we're still authorized
            requestAuthToken(false, (token, error) => {
                if (error || !token) {
                    updateStatus('Not connected');
                } else {
                    updateStatus('Connected');
                    showSpreadsheetLink(result.spreadsheetId);
                    ensureSpreadsheetStyled(result.spreadsheetId, token, () => {});
                }
            });
            return;
        }

        // No cached ID - if we're still silently authorized, check Drive for a
        // spreadsheet this app created previously (e.g. before a reinstall)
        requestAuthToken(false, (token, error) => {
            if (error || !token) {
                updateStatus('Not connected');
                return;
            }
            findExistingSpreadsheet(token);
        });
    });
}

function showSpreadsheetLink(spreadsheetId) {
    const spreadsheetLink = document.getElementById('spreadsheetLink');
    const openSpreadsheet = document.getElementById('openSpreadsheet');
    if (spreadsheetLink && openSpreadsheet) {
        openSpreadsheet.href = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        spreadsheetLink.style.display = 'block';
    }
}

function addManualEntry(event) {
    event.preventDefault();

    const title = document.getElementById('jobTitleInput').value.trim();
    const company = document.getElementById('companyInput').value.trim();
    const status = document.getElementById('statusInput').value;
    const type = document.getElementById('typeInput').value;
    const location = document.getElementById('locationInput').value.trim();
    const salary = document.getElementById('salaryInput').value.trim();
    const deadline = document.getElementById('deadlineInput').value;
    const link = document.getElementById('linkInput').value.trim();
    const notes = document.getElementById('notesInput').value.trim();

    if (!title || !company) {
        setFeedback(document.getElementById('manualFeedback'), 'Please fill in job title and company.', 'error');
        return;
    }

    chrome.storage.sync.get(['spreadsheetId', 'sheetGid'], (result) => {
        if (!result.spreadsheetId) {
            setFeedback(document.getElementById('manualFeedback'), 'Connect Google Sheets first.', 'error');
            return;
        }

        requestAuthToken(true, (token, error) => {
            if (error || !token) {
                console.error('Auth error:', error);
                setFeedback(document.getElementById('manualFeedback'), 'Authentication failed. Try reconnecting.', 'error');
                return;
            }

            const dateAdded = new Date().toLocaleDateString();
            const row = [title, company, status, type, dateAdded, location, salary, deadline, buildLinkCellValue(link), notes];

            setFeedback(document.getElementById('manualFeedback'), 'Adding…', '');
            appendRowToSheet(result.spreadsheetId, result.sheetGid, token, row);
        });
    });
}

function resetAppendedRowFormatting(spreadsheetId, gid, token, updatedRange, columnCount, onDone) {
    if (gid === null || gid === undefined) { onDone(); return; }

    const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
    if (!match) { onDone(); return; }

    const startRowIndex = parseInt(match[1], 10) - 1;
    const endRowIndex = parseInt(match[2], 10);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requests: [{
                repeatCell: {
                    range: { sheetId: gid, startRowIndex, endRowIndex, startColumnIndex: 0, endColumnIndex: columnCount },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                            textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor,textFormat.bold)'
                }
            }]
        })
    })
    .then(response => response.json())
    .catch(error => console.error('Error resetting appended row formatting:', error))
    .finally(() => onDone());
}

// Append a row to Sheet1 via the Sheets API values.append endpoint
function appendRowToSheet(spreadsheetId, gid, token, rowValues) {
    const range = 'Sheet1!A1';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    fetch(url, {
        method: 'POST',
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
    .then((data) => {
        const updatedRange = data.updates && data.updates.updatedRange;
        const finish = () => {
            setFeedback(document.getElementById('manualFeedback'), '✅ Added to spreadsheet!', 'success');
            document.getElementById('manualEntryForm').reset();
            loadJobsFromSheet();
            if (rowValues[2] === 'Applied' && typeof triggerConfetti === 'function') {
                triggerConfetti();
            }
        };
        if (updatedRange && gid !== undefined && gid !== null) {
            resetAppendedRowFormatting(spreadsheetId, gid, token, updatedRange, SHEET_HEADERS.length, finish);
        } else {
            finish();
        }
    })
    .catch(error => {
        console.error('Error adding row:', error);
        setFeedback(document.getElementById('manualFeedback'), '❌ Failed to add — see console.', 'error');
    });
}

function disconnectAccount() {
    requestAuthToken(false, (token, error) => {
        if (error || !token) {
            purgeAllCachedTokens(finishDisconnect);
            return;
        }

        fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' })
        .catch(error => console.error('Error revoking token:', error))
        .finally(() => {

            chrome.identity.removeCachedAuthToken({ token }, () => {
                purgeAllCachedTokens(finishDisconnect);
            });
        });
    });
}

function purgeAllCachedTokens(onDone) {
    if (chrome.identity.clearAllCachedAuthTokens) {
        chrome.identity.clearAllCachedAuthTokens(() => onDone());
    } else {
        onDone();
    }
}

// Clear stored spreadsheet + reset the UI back to "Not connected"
function finishDisconnect() {
    chrome.storage.sync.remove(['spreadsheetId', 'sheetGid'], () => {
        const spreadsheetLink = document.getElementById('spreadsheetLink');
        if (spreadsheetLink) spreadsheetLink.style.display = 'none';
        updateStatus('Not connected');
        console.log('Disconnected. Ready to reconnect with a different account if needed.');
    });
}

function setFeedback(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = 'manual-feedback' + (type ? ` ${type}` : '');
}

// Authenticate the user using Chrome Identity API (via the background
function authenticateUser() {
    requestAuthToken(true, (token, error) => {
        if (error || !token) {
            console.error('OAuth authentication failed:', error);
            updateStatus('Connection failed');
            return;
        }

        console.log('Token received:', token);

        // Check if the user already has a spreadsheet
        chrome.storage.sync.get(['spreadsheetId'], (result) => {
            if (result.spreadsheetId) {
                console.log('Existing spreadsheet found:', result.spreadsheetId);
                updateStatus('Connected');
                showSpreadsheetLink(result.spreadsheetId);
                makeApiRequest(result.spreadsheetId, token);
            } else {
                findExistingSpreadsheet(token);
            }
        });
    });
}

const APPLYLOG_SHEET_NAME = 'ApplyLog - Job Applications';

function findExistingSpreadsheet(oauthToken) {
    const query = encodeURIComponent(
        `name='${APPLYLOG_SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,createdTime)&orderBy=createdTime desc`;

    fetch(url, {
        headers: { 'Authorization': `Bearer ${oauthToken}` }
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(error => {
                throw new Error(`Error searching Drive: ${JSON.stringify(error)}`);
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.files && data.files.length > 0) {
            const existingId = data.files[0].id;
            console.log('Found existing spreadsheet:', existingId);
            chrome.storage.sync.set({ spreadsheetId: existingId }, () => {
                chrome.storage.sync.remove(['sheetGid', 'styleVersion']);
                updateStatus('Connected');
                showSpreadsheetLink(existingId);
                ensureSpreadsheetStyled(existingId, oauthToken, () => {});
            });
        } else {
            createNewSpreadsheet(oauthToken);
        }
    })
    .catch(error => {
        console.error('Error searching for existing spreadsheet:', error);
        createNewSpreadsheet(oauthToken);
    });
}

function createNewSpreadsheet(oauthToken) {
    const url = 'https://sheets.googleapis.com/v4/spreadsheets';

    fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            properties: { title: APPLYLOG_SHEET_NAME },
            sheets: [{ properties: { title: 'Sheet1' } }]
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(error => {
                throw new Error(`Error creating sheet: ${JSON.stringify(error)}`);
            });
        }
        return response.json();
    })
    .then(data => {
        const newSpreadsheetId = data.spreadsheetId;
        const newSheetGid = data.sheets && data.sheets[0] ? data.sheets[0].properties.sheetId : null;
        console.log('New user-specific sheet created with ID:', newSpreadsheetId);

        // Write headers, then style the sheet, before storing/using it
        addHeaderRow(newSpreadsheetId, oauthToken, () => {
            styleSpreadsheet(newSpreadsheetId, newSheetGid, oauthToken, () => {
                chrome.storage.sync.set({ spreadsheetId: newSpreadsheetId, sheetGid: newSheetGid, styleVersion: SPREADSHEET_STYLE_VERSION }, () => {
                    console.log('User-specific spreadsheet ID stored.');
                    updateStatus('Connected');
                    showSpreadsheetLink(newSpreadsheetId);
                });
            });
        });
    })
    .catch(error => {
        console.error('Error creating the sheet:', error);
        updateStatus('Connection failed');
    });
}

// Write the header row into a freshly created spreadsheet
function addHeaderRow(spreadsheetId, oauthToken, onDone) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`;

    fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [SHEET_HEADERS] })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(error => {
                throw new Error(`Error writing headers: ${JSON.stringify(error)}`);
            });
        }
        return response.json();
    })
    .then(() => onDone())
    .catch(error => {
        console.error('Error writing header row:', error);
        onDone();
    });
}

function styleSpreadsheet(spreadsheetId, gid, oauthToken, onDone) {
    if (gid === null || gid === undefined) { onDone(); return; }

    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties.sheetId,conditionalFormats,bandedRanges.bandedRangeId)`;

    fetch(metaUrl, { headers: { 'Authorization': `Bearer ${oauthToken}` } })
    .then(response => response.json())
    .then(meta => {
        const sheet = (meta.sheets || []).find(s => s.properties && s.properties.sheetId === gid);
        const ruleCount = sheet && sheet.conditionalFormats ? sheet.conditionalFormats.length : 0;
        const bandedRangeIds = sheet && sheet.bandedRanges ? sheet.bandedRanges.map(b => b.bandedRangeId) : [];

        const cleanupRequests = [
            ...Array.from({ length: ruleCount }, () => ({ deleteConditionalFormatRule: { sheetId: gid, index: 0 } })),
            ...bandedRangeIds.map(bandedRangeId => ({ deleteBanding: { bandedRangeId } }))
        ];

        applyStyleRequests(spreadsheetId, gid, oauthToken, cleanupRequests, onDone);
    })
    .catch(error => {
        console.error('Error reading existing sheet formatting, styling anyway:', error);
        applyStyleRequests(spreadsheetId, gid, oauthToken, [], onDone);
    });
}

function applyStyleRequests(spreadsheetId, gid, oauthToken, cleanupRequests, onDone) {
    const rgb = (hex) => ({
        red: parseInt(hex.slice(0, 2), 16) / 255,
        green: parseInt(hex.slice(2, 4), 16) / 255,
        blue: parseInt(hex.slice(4, 6), 16) / 255
    });

    const columnWidths = [190, 150, 110, 110, 100, 175, 115, 105, 90, 220];

    const statusColors = [
        { value: 'Saved',        text: 'ad7231' }, // Bronze Testudo
        { value: 'Applied',      text: '454545' }, // Dark Gray
        { value: 'Interviewing', text: 'e21833' }, // Maryland Red
        { value: 'Offer',        text: '8a6d00' }, // Maryland Gold (darkened for legibility)
        { value: 'Rejected',     text: '000000' }  // Black
    ];

    const requests = [
        ...cleanupRequests,
        {
            updateSheetProperties: {
                properties: {
                    sheetId: gid,
                    gridProperties: { frozenRowCount: 1 },
                    tabColor: rgb('e21833')
                },
                fields: 'gridProperties.frozenRowCount,tabColor'
            }
        },

        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SHEET_HEADERS.length },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: rgb('000000'),
                        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                        verticalAlignment: 'MIDDLE',
                        horizontalAlignment: 'CENTER'
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)'
            }
        },

        {
            updateDimensionProperties: {
                range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 34 },
                fields: 'pixelSize'
            }
        },
        ...columnWidths.map((width, i) => ({
            updateDimensionProperties: {
                range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
                properties: { pixelSize: width },
                fields: 'pixelSize'
            }
        })),

        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: SHEET_HEADERS.length },
                cell: { userEnteredFormat: { backgroundColor: rgb('ffffff') } },
                fields: 'userEnteredFormat.backgroundColor'
            }
        },

        // Clip instead of overflow: long values (addresses, salary ranges, etc.)
        // get cut off at the column boundary rather than visually bleeding into
        // the next column when that neighboring cell has its own content.
        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: SHEET_HEADERS.length },
                cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
                fields: 'userEnteredFormat.wrapStrategy'
            }
        },

        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 5 },
                cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)'
            }
        },

        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 7, endColumnIndex: 8 },
                cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)'
            }
        },

        {
            setDataValidation: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
                rule: {
                    condition: { type: 'ONE_OF_LIST', values: STATUS_OPTIONS.map(v => ({ userEnteredValue: v })) },
                    showCustomUi: true,
                    strict: false
                }
            }
        },

        {
            setDataValidation: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 },
                rule: {
                    condition: { type: 'ONE_OF_LIST', values: TYPE_OPTIONS.map(v => ({ userEnteredValue: v })) },
                    showCustomUi: true,
                    strict: false
                }
            }
        },

        ...statusColors.map(({ value, text }) => ({
            addConditionalFormatRule: {
                rule: {
                    ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 }],
                    booleanRule: {
                        condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
                        format: { textFormat: { foregroundColor: rgb(text), bold: true } }
                    }
                },
                index: 0
            }
        })),

        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
                cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)'
            }
        },
        {
            repeatCell: {
                range: { sheetId: gid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 9, endColumnIndex: 10 },
                cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
                fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)'
            }
        },

        {
            updateBorders: {
                range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: SHEET_HEADERS.length },
                top: { style: 'SOLID', width: 1, color: rgb('e6e6e6') },
                bottom: { style: 'SOLID', width: 1, color: rgb('e6e6e6') },
                left: { style: 'SOLID', width: 1, color: rgb('e6e6e6') },
                right: { style: 'SOLID', width: 1, color: rgb('e6e6e6') },
                innerHorizontal: { style: 'SOLID', width: 1, color: rgb('e6e6e6') },
                innerVertical: { style: 'SOLID', width: 1, color: rgb('e6e6e6') }
            }
        },

        {
            setBasicFilter: {
                filter: {
                    range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: SHEET_HEADERS.length }
                }
            }
        }
    ];

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(error => {
                throw new Error(`Error styling sheet: ${JSON.stringify(error)}`);
            });
        }
        return response.json();
    })
    .then(() => onDone())
    .catch(error => {
        console.error('Error styling spreadsheet:', error);
        onDone();
    });
}

// Function to make an API request to the user's personalized sheet
function makeApiRequest(spreadsheetId, oauthToken) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1`;

    fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${oauthToken}`
        }
    })
    .then(response => response.json())
    .then(data => console.log('Data from user-specific sheet:', data))
    .catch(error => console.error('Error fetching data:', error));
}

// Function to update the UI to show connection status
function updateStatus(status) {
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = statusIndicator.querySelector('.status-text');
    const statusDot = statusIndicator.querySelector('.status-dot');
    const connectBanner = document.getElementById('connectBanner');
    const connectBtn = document.getElementById('connectBtn');

    if (status === 'Connected') {
        statusText.textContent = 'Connected';
        statusDot.classList.add('connected');
        statusDot.style.backgroundColor = '';
        if (connectBanner) connectBanner.style.display = 'none';
        loadJobsFromSheet();
    } else {
        statusText.textContent = 'Not connected';
        statusDot.classList.remove('connected');
        statusDot.style.backgroundColor = '';
        if (connectBanner) connectBanner.style.display = 'flex';
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect';
        }
        resetJobLists();
    }
}