// app.js

let serverSettings = { closedDates: [] };
let authToken = localStorage.getItem('authToken') || null;
let userRole = localStorage.getItem('userRole') || null;

// --- Constants & Config ---
const START_HOUR = 10;
const END_HOUR = 17; // 5 PM
const SLOT_DURATION = 10; // minutes
const BREAK_START = { h: 14, m: 0 }; // 2:00 PM
const BREAK_END = { h: 14, m: 30 }; // 2:30 PM

// --- Utilities ---
function formatTime(h, m) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    const minStr = m.toString().padStart(2, '0');
    return `${hour12}:${minStr} ${ampm}`;
}

function generateTimeSlots() {
    const slots = [];
    let currentH = START_HOUR;
    let currentM = 0;

    while (currentH < END_HOUR || (currentH === END_HOUR && currentM === 0)) {
        if (currentH === END_HOUR && currentM === 0) break;

        const startTime = formatTime(currentH, currentM);
        
        let nextM = currentM + SLOT_DURATION;
        let nextH = currentH;
        if (nextM >= 60) {
            nextM -= 60;
            nextH++;
        }
        
        const endTime = formatTime(nextH, nextM);
        const isBreak = (currentH === BREAK_START.h && currentM >= BREAK_START.m && currentM < BREAK_END.m);
        
        slots.push({
            startH: currentH,
            startM: currentM,
            startStr: startTime,
            endStr: endTime,
            isBreak: isBreak,
            id: `${currentH.toString().padStart(2, '0')}:${currentM.toString().padStart(2, '0')}`
        });

        currentH = nextH;
        currentM = nextM;
    }
    return slots;
}

const ALL_SLOTS = generateTimeSlots();

// --- DOM Elements ---
const viewBook = document.getElementById('view-book');
const viewCancel = document.getElementById('view-cancel');
const viewStaffLogin = document.getElementById('view-staff-login');
const viewStaffDashboard = document.getElementById('view-staff-dashboard');
const viewAdminDashboard = document.getElementById('view-admin-dashboard');

const navBook = document.getElementById('nav-book');
const navCancel = document.getElementById('nav-cancel');
const navStaff = document.getElementById('nav-staff');

const datePicker = document.getElementById('booking-date');
const dateStatusText = document.getElementById('date-status-text');
const dateStatusBanner = document.querySelector('.status-banner');
const slotsDateDisplay = document.getElementById('slots-date-display');
const tbody = document.getElementById('slots-tbody');
const slotsTableContainer = document.querySelector('.slots-table-container');

// Modals
const bookingModal = document.getElementById('booking-modal');
const successModal = document.getElementById('success-modal');
const bookingForm = document.getElementById('booking-form');

// Cancellation Elements
const findBookingForm = document.getElementById('find-booking-form');
const cancelResult = document.getElementById('cancel-result');

// Staff/Admin Elements
const staffLoginForm = document.getElementById('staff-login-form');
const holidayList = document.getElementById('holiday-list');
const addHolidayForm = document.getElementById('add-holiday-form');
const adminRosterDate = document.getElementById('admin-roster-date');
const adminRosterList = document.getElementById('admin-roster-list');
const staffRosterDate = document.getElementById('staff-roster-date');
const staffRosterList = document.getElementById('staff-roster-list');
const adminExportCsvBtn = document.getElementById('admin-export-csv-btn');
const staffExportCsvBtn = document.getElementById('staff-export-csv-btn');
const adminStaffList = document.getElementById('admin-staff-list');
const addStaffForm = document.getElementById('add-staff-form');
const adminLogsTbody = document.getElementById('admin-logs-tbody');

let currentSelectedDate = '';
let currentBookingSlot = null;
let currentCancelTarget = null;
let currentDayData = {};

// --- Toast Notification ---
function showToast(msg, isError = false) {
    const toast = document.getElementById('status-toast');
    toast.textContent = msg;
    toast.style.background = isError ? '#8c2a3e' : '#1a252f';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

// --- API Helpers ---
async function fetchAPI(endpoint, options = {}) {
    options.headers = options.headers || {};
    if (authToken) options.headers['x-auth-token'] = authToken;
    try {
        const res = await fetch(endpoint, options);
        const data = await res.json();
        if (res.status === 401 || res.status === 403) {
            handleLogout();
            throw new Error('Session expired. Please log in again.');
        }
        if (!res.ok) throw new Error(data.error || 'Server error');
        return data;
    } catch (err) {
        const msg = err.message.includes('Failed to fetch')
            ? 'Network error — please check your connection.'
            : err.message;
        showToast(msg, true);
        throw err;
    }
}

// --- Initialization ---
async function init() {
    try {
        serverSettings = await fetchAPI('/api/settings');
    } catch (e) {
        console.error("Could not load settings");
    }

    const today = new Date().toISOString().split('T')[0];
    datePicker.value = today;
    datePicker.min = today; 
    if (adminRosterDate) adminRosterDate.value = today;
    if (staffRosterDate) staffRosterDate.value = today;
    await handleDateChange(today);

    // Nav Listeners
    navBook.addEventListener('click', () => switchView('book'));
    navCancel.addEventListener('click', () => switchView('cancel'));
    navStaff.addEventListener('click', () => switchView('staff'));
    
    // Book View Listeners
    datePicker.addEventListener('change', (e) => handleDateChange(e.target.value));
    document.querySelector('.next-day-btn').addEventListener('click', () => {
        const d = new Date(datePicker.value);
        d.setDate(d.getDate() + 1);
        const nextDate = d.toISOString().split('T')[0];
        datePicker.value = nextDate;
        handleDateChange(nextDate);
    });

    document.getElementById('cancel-booking-btn').addEventListener('click', () => {
        bookingModal.style.display = 'none';
        bookingForm.reset();
    });
    bookingForm.addEventListener('submit', handleBookingSubmit);
    document.getElementById('success-done-btn').addEventListener('click', () => successModal.style.display = 'none');
    document.getElementById('download-token-btn').addEventListener('click', downloadTokenAsImage);

    // Cancel View Listeners
    findBookingForm.addEventListener('submit', handleFindBooking);
    document.getElementById('confirm-cancel-btn').addEventListener('click', handleConfirmCancel);

    // Staff/Admin View Listeners
    staffLoginForm.addEventListener('submit', handleStaffLogin);
    addHolidayForm.addEventListener('submit', handleAddHoliday);
    adminRosterDate.addEventListener('change', (e) => renderRoster(e.target.value, 'admin'));
    staffRosterDate.addEventListener('change', (e) => renderRoster(e.target.value, 'staff'));
    adminExportCsvBtn.addEventListener('click', () => handleExportCSV(adminRosterDate.value, 'admin'));
    staffExportCsvBtn.addEventListener('click', () => handleExportCSV(staffRosterDate.value, 'staff'));
    addStaffForm.addEventListener('submit', handleAddStaff);
    
    document.getElementById('staff-logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('admin-logout-btn')?.addEventListener('click', handleLogout);
}

// --- View Logic ---
function switchView(viewName) {
    viewBook.style.display = 'none';
    viewCancel.style.display = 'none';
    viewStaffLogin.style.display = 'none';
    viewStaffDashboard.style.display = 'none';
    viewAdminDashboard.style.display = 'none';
    
    navBook.classList.remove('active');
    navCancel.classList.remove('active');
    navStaff.classList.remove('active');

    if (viewName === 'book') {
        viewBook.style.display = 'block';
        navBook.classList.add('active');
        handleDateChange(currentSelectedDate || datePicker.value);
    } else if (viewName === 'cancel') {
        viewCancel.style.display = 'block';
        navCancel.classList.add('active');
        cancelResult.style.display = 'none';
        findBookingForm.reset();
        document.getElementById('cancel-date').value = currentSelectedDate;
    } else if (viewName === 'staff') {
        navStaff.classList.add('active');
        if (authToken) {
            if (userRole === 'admin') {
                viewAdminDashboard.style.display = 'block';
                renderHolidays();
                renderRoster(adminRosterDate.value, 'admin');
                loadAdminStaffList();
                loadAdminLogs();
            } else {
                viewStaffDashboard.style.display = 'block';
                renderRoster(staffRosterDate.value, 'staff');
            }
        } else {
            viewStaffLogin.style.display = 'block';
        }
    }
}

// --- Date & Holiday Logic ---
function isDateClosed(dateStr) {
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateStr < todayStr) return true; 

    const d = new Date(dateStr);
    const dayOfWeek = d.getDay();
    const dateNum = d.getDate();
    
    // Sundays
    if (dayOfWeek === 0) return true;
    
    // 2nd and 4th Saturdays
    if (dayOfWeek === 6) {
        const weekNum = Math.ceil(dateNum / 7);
        if (weekNum === 2 || weekNum === 4) return true;
    }

    if (serverSettings.closedDates && serverSettings.closedDates.includes(dateStr)) return true;

    return false;
}

async function handleDateChange(dateStr) {
    currentSelectedDate = dateStr;
    const dateObj = new Date(dateStr);
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const formattedDate = dateObj.toLocaleDateString('en-GB', options);
    
    slotsDateDisplay.textContent = formattedDate;

    if (isDateClosed(dateStr)) {
        dateStatusText.textContent = `Closed — ${formattedDate}`;
        dateStatusBanner.style.backgroundColor = 'var(--color-taken-bg)';
        dateStatusBanner.style.color = 'var(--color-taken-text)';
        dateStatusBanner.style.borderColor = 'rgba(140, 42, 62, 0.2)';
        slotsTableContainer.style.display = 'none';
    } else {
        dateStatusText.textContent = `Open — ${formattedDate}`;
        dateStatusBanner.style.backgroundColor = 'var(--color-available-bg)';
        dateStatusBanner.style.color = 'var(--text-green)';
        dateStatusBanner.style.borderColor = 'rgba(45, 74, 62, 0.2)';
        slotsTableContainer.style.display = 'block';
        await loadAndRenderSlots(dateStr);
    }
}

async function loadAndRenderSlots(dateStr) {
    if (isDateClosed(dateStr)) return;
    try {
        currentDayData = await fetchAPI(`/api/bookings/${dateStr}`);
        renderSlots(dateStr, currentDayData);
    } catch (e) {
        console.error("Failed to load slots");
    }
}

function renderSlots(dateStr, dayData) {
    tbody.innerHTML = '';
    ALL_SLOTS.forEach((slot, index) => {
        const tr = document.createElement('tr');
        
        const tdTime = document.createElement('td');
        tdTime.textContent = `${slot.startStr} – ${slot.endStr}`;
        tr.appendChild(tdTime);

        ['C1', 'C2'].forEach(comp => {
            const td = document.createElement('td');
            const slotKey = `${slot.id}_${comp}`;
            const booking = dayData[slotKey];

            if (slot.isBreak) {
                td.className = 'slot-break';
                td.innerHTML = '<span class="box break" style="width:10px;height:10px;display:inline-block;margin-right:5px"></span> Break / closed';
            } else if (booking) {
                if (booking.status === 'booked') {
                    td.className = 'slot-cell slot-taken';
                    td.innerHTML = `
                        <div class="booking-info">
                            <span class="booking-name"><i class="icon-check">✓</i> ${booking.name}</span>
                            <span class="booking-meta-small">${booking.rollNo} &middot; ${booking.duration} min</span>
                        </div>
                    `;
                } else if (booking.status === 'continued') {
                    td.className = 'slot-cell slot-taken-continued';
                    td.innerHTML = `
                        <div class="booking-info">
                            <span class="booking-name"><i class="icon-clock"></i> continued (same student)</span>
                        </div>
                    `;
                }
            } else {
                td.className = 'slot-cell slot-available';
                td.innerHTML = `${slot.startStr} &middot; Reserve`;
                td.addEventListener('click', () => openBookingModal(dateStr, slot, comp, index));
            }
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// --- Booking Logic (Client) ---
function openBookingModal(dateStr, slot, comp, slotIndex) {
    currentBookingSlot = {
        date: dateStr,
        timeId: slot.id,
        computerId: comp,
        startStr: slot.startStr,
        endStr: slot.endStr,
        index: slotIndex
    };

    const compName = comp === 'C1' ? 'Computer 1' : 'Computer 2';
    document.getElementById('modal-slot-info').innerHTML = `${compName} &middot; ${slot.startStr} – ${slot.endStr}`;
    
    const isNextAvailable = checkNextSlotAvailable(dateStr, comp, slotIndex);
    const under18Checkbox = document.getElementById('under-18');
    
    if (!isNextAvailable) {
        under18Checkbox.disabled = true;
        under18Checkbox.parentElement.style.opacity = '0.5';
    } else {
        under18Checkbox.disabled = false;
        under18Checkbox.parentElement.style.opacity = '1';
    }

    bookingForm.reset();
    bookingModal.style.display = 'flex';
}

function checkNextSlotAvailable(dateStr, comp, currentIndex) {
    if (currentIndex + 1 >= ALL_SLOTS.length) return false;
    const nextSlot = ALL_SLOTS[currentIndex + 1];
    if (nextSlot.isBreak) return false;
    return !currentDayData[`${nextSlot.id}_${comp}`];
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('student-name').value;
    const rollNo = document.getElementById('student-roll').value;
    const department = document.getElementById('student-class').value;
    const isUnder18 = document.getElementById('under-18').checked;
    
    if (isUnder18 && !checkNextSlotAvailable(currentBookingSlot.date, currentBookingSlot.computerId, currentBookingSlot.index)) {
        alert("Cannot book 20 minutes as the next slot is unavailable.");
        return;
    }

    const cancelCode = Math.floor(1000 + Math.random() * 9000).toString();
    const slotKey = `${currentBookingSlot.timeId}_${currentBookingSlot.computerId}`;
    let continuedSlotKey = null;
    let endStrFinal = currentBookingSlot.endStr;

    if (isUnder18) {
        const nextSlot = ALL_SLOTS[currentBookingSlot.index + 1];
        continuedSlotKey = `${nextSlot.id}_${currentBookingSlot.computerId}`;
        endStrFinal = nextSlot.endStr;
    }

    const payload = {
        date: currentBookingSlot.date,
        slot_key: slotKey,
        name, rollNo, department, isUnder18, 
        duration: isUnder18 ? 20 : 10, 
        cancelCode, continuedSlotKey
    };

    try {
        await fetchAPI('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        bookingModal.style.display = 'none';
        
        const compName = currentBookingSlot.computerId === 'C1' ? 'Computer 1' : 'Computer 2';
        document.getElementById('success-slot-info').innerHTML = `${compName} &middot; ${currentBookingSlot.startStr} – ${endStrFinal}`;
        document.getElementById('generated-code').textContent = cancelCode.split('').join(' ');
        
        successModal.style.display = 'flex';
        await loadAndRenderSlots(currentBookingSlot.date);
    } catch (e) {
        // Error already handled by fetchAPI with toast, but adding a true pop-up alert as requested.
        alert(e.message || "Failed to book slot.");
    }
}

function downloadTokenAsImage() {
    const tokenCard = document.getElementById('token-card');
    if (typeof html2canvas !== 'undefined') {
        html2canvas(tokenCard, { 
            scale: 2, 
            backgroundColor: "#faf9f6"
        }).then(canvas => {
            const image = canvas.toDataURL("image/png");
            const link = document.createElement('a');
            link.download = `booking-token-${currentSelectedDate}.png`;
            link.href = image;
            link.click();
        }).catch(err => {
            alert("Could not generate image. Please screenshot manually.");
        });
    } else {
        alert("Image generation library not loaded. Please screenshot manually.");
    }
}

// --- Cancellation Logic (Client) ---
async function handleFindBooking(e) {
    e.preventDefault();
    const rollNoToFind = document.getElementById('cancel-roll').value.trim();
    const dateToFind = document.getElementById('cancel-date').value;
    
    try {
        const dayData = await fetchAPI(`/api/bookings/${dateToFind}`);
        
        let foundSlotKey = null;
        let foundData = null;

        for (const [key, data] of Object.entries(dayData)) {
            if (data.status === 'booked' && data.rollNo.toLowerCase() === rollNoToFind.toLowerCase()) {
                foundSlotKey = key;
                foundData = data;
                break;
            }
        }

        if (foundSlotKey) {
            currentCancelTarget = { date: dateToFind, key: foundSlotKey, code: foundData.cancelCode };
            const [timeId, comp] = foundSlotKey.split('_');
            const compName = comp === 'C1' ? 'Computer 1' : 'Computer 2';
            
            const startSlotIndex = ALL_SLOTS.findIndex(s => s.id === timeId);
            let endStr = ALL_SLOTS[startSlotIndex].endStr;
            if (foundData.duration === 20) endStr = ALL_SLOTS[startSlotIndex + 1].endStr;

            document.getElementById('cancel-name-display').textContent = foundData.name.toUpperCase();
            document.getElementById('cancel-time-display').innerHTML = `${compName} &middot; ${ALL_SLOTS[startSlotIndex].startStr}–${endStr} (${foundData.duration} min)`;
            
            document.getElementById('cancel-code-input').value = '';
            cancelResult.style.display = 'flex';
        } else {
            alert('No booking found for this Register/Roll No. on the selected date.');
            cancelResult.style.display = 'none';
        }
    } catch (e) {}
}

async function handleConfirmCancel() {
    if (!currentCancelTarget) {
        showToast('Please search for your booking first.', true);
        return;
    }
    const enteredCode = document.getElementById('cancel-code-input').value.trim();
    if (!enteredCode || enteredCode.length < 4) {
        showToast('Please enter your 4-digit cancellation code.', true);
        return;
    }
    
    try {
        await fetchAPI('/api/bookings/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: currentCancelTarget.date,
                slot_key: currentCancelTarget.key,
                code: enteredCode
            })
        });
        
        showToast('Booking cancelled successfully! ✓');
        cancelResult.style.display = 'none';
        findBookingForm.reset();
        if (currentSelectedDate === currentCancelTarget.date) {
            await loadAndRenderSlots(currentSelectedDate);
        }
        currentCancelTarget = null;
    } catch (e) {
        // Error already shown by showToast in fetchAPI
    }
}

// --- Auth & Admin/Staff Logic ---
async function handleStaffLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        const res = await fetchAPI('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        authToken = res.token;
        userRole = res.role;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('userRole', userRole);
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        switchView('staff');
    } catch (e) {}
}

async function handleLogout() {
    try {
        if(authToken) await fetchAPI('/api/auth/logout', { method: 'POST' });
    } catch(e) {}
    authToken = null;
    userRole = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    switchView('book');
}

async function handlePasswordChange(e) {
    e.preventDefault();
    const oldPassword = e.target.querySelector('.old-password').value;
    const newPassword = e.target.querySelector('.new-password').value;
    const confirmPassword = e.target.querySelector('.confirm-password').value;

    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match!', true);
        return;
    }

    try {
        await fetchAPI('/api/auth/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        showToast('Password changed successfully. ✓');
        e.target.reset();
    } catch (err) {}
}

// ... Holidays ...
function renderHolidays() {
    holidayList.innerHTML = '';
    
    serverSettings.closedDates.sort().forEach(dateStr => {
        const d = new Date(dateStr);
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        
        const li = document.createElement('li');
        li.textContent = d.toLocaleDateString('en-GB', options);
        
        const btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.innerHTML = '&times;';
        btn.onclick = async () => {
            try {
                const res = await fetchAPI(`/api/settings/holidays/${dateStr}`, { method: 'DELETE' });
                serverSettings.closedDates = res.closedDates;
                renderHolidays();
                if(dateStr === currentSelectedDate) handleDateChange(currentSelectedDate);
            } catch(e) {}
        };
        li.appendChild(btn);
        holidayList.appendChild(li);
    });
}

async function handleAddHoliday(e) {
    e.preventDefault();
    const dateStr = document.getElementById('new-holiday-date').value;
    if (!serverSettings.closedDates.includes(dateStr)) {
        try {
            const res = await fetchAPI('/api/settings/holidays', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateStr })
            });
            serverSettings.closedDates = res.closedDates;
            renderHolidays();
            document.getElementById('new-holiday-date').value = '';
            if(dateStr === currentSelectedDate) handleDateChange(currentSelectedDate);
        } catch(e) {}
    }
}

// ... Admin Staff Mgmt ...
async function loadAdminStaffList() {
    try {
        const staffList = await fetchAPI('/api/admin/staff');
        adminStaffList.innerHTML = '';
        staffList.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s.username;
            const btn = document.createElement('button');
            btn.className = 'remove-btn';
            btn.innerHTML = '&times;';
            btn.onclick = async () => {
                if(confirm('Delete this staff account?')) {
                    await fetchAPI(`/api/admin/staff/${s.username}`, { method: 'DELETE' });
                    loadAdminStaffList();
                }
            };
            li.appendChild(btn);
            adminStaffList.appendChild(li);
        });
    } catch(e) {}
}

async function handleAddStaff(e) {
    e.preventDefault();
    const user = document.getElementById('new-staff-user').value;
    const pass = document.getElementById('new-staff-pass').value;
    try {
        await fetchAPI('/api/admin/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        document.getElementById('new-staff-user').value = '';
        document.getElementById('new-staff-pass').value = '';
        loadAdminStaffList();
    } catch(e) {}
}

async function loadAdminLogs() {
    try {
        const logs = await fetchAPI('/api/admin/logs');
        adminLogsTbody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td>${log.username}</td>
                <td>${log.action}</td>
            `;
            adminLogsTbody.appendChild(tr);
        });
    } catch(e) {}
}

// ... Roster ...
async function renderRoster(dateStr, role) {
    const rList = role === 'admin' ? adminRosterList : staffRosterList;
    rList.innerHTML = 'Loading...';
    try {
        const endpoint = role === 'admin' ? `/api/bookings/${dateStr}` : `/api/staff/roster/${dateStr}`;
        const dayData = await fetchAPI(endpoint);
        rList.innerHTML = '';
        let hasBookings = false;
        const bookings = [];

        for (const [key, data] of Object.entries(dayData)) {
            if (data.status === 'booked') {
                const [timeId, comp] = key.split('_');
                const startSlotIndex = ALL_SLOTS.findIndex(s => s.id === timeId);
                let endStr = ALL_SLOTS[startSlotIndex].endStr;
                if (data.duration === 20) endStr = ALL_SLOTS[startSlotIndex + 1].endStr;
                
                bookings.push({
                    key, data, timeId, comp,
                    compName: comp === 'C1' ? 'Computer 1' : 'Computer 2',
                    startStr: ALL_SLOTS[startSlotIndex].startStr,
                    endStr
                });
            }
        }

        bookings.sort((a, b) => {
            if (a.timeId === b.timeId) return a.comp.localeCompare(b.comp);
            return a.timeId.localeCompare(b.timeId);
        });

        bookings.forEach(b => {
            hasBookings = true;
            const item = document.createElement('div');
            item.className = 'roster-item';
            
            let subtext = `${b.compName} &middot; ${b.startStr}–${b.endStr}`;
            if(b.data.isUnder18) subtext += ` &middot; under 18`;

            let freeBtn = role === 'admin' 
                ? `<button type="button" class="btn danger" onclick="adminFreeSlot('${dateStr}', '${b.key}')">Free slot</button>`
                : '';

            item.innerHTML = `
                <div class="roster-details">
                    <h4>${b.data.name.toUpperCase()} (${b.data.rollNo}, ${b.data.department || 'N/A'})</h4>
                    <p>${subtext}</p>
                </div>
                ${freeBtn}
            `;
            rList.appendChild(item);
        });

        if (!hasBookings) {
            rList.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No bookings for this date.</p>';
        }
    } catch(e) {
        rList.innerHTML = 'Error loading roster.';
    }
}

window.adminFreeSlot = async function(dateStr, key) {
    if(confirm('Are you sure you want to cancel this booking and free the slot?')) {
        try {
            await fetchAPI('/api/admin/free', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateStr, slot_key: key })
            });
            showToast('Slot freed successfully. ✓');
            renderRoster(dateStr, 'admin');
            if(currentSelectedDate === dateStr) loadAndRenderSlots(dateStr);
        } catch(e) {}
    }
};

async function handleExportCSV(dateStr, role) {
    try {
        const endpoint = role === 'admin' ? `/api/bookings/${dateStr}` : `/api/staff/roster/${dateStr}`;
        const dayData = await fetchAPI(endpoint);
        
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Computer,Time,Name,Roll No,Department,Duration,Under 18\r\n";

        for (const [key, data] of Object.entries(dayData)) {
            if (data.status === 'booked') {
                const [timeId, comp] = key.split('_');
                const compName = comp === 'C1' ? 'Computer 1' : 'Computer 2';
                const row = [
                    compName,
                    timeId,
                    `"${data.name}"`,
                    `"${data.rollNo}"`,
                    `"${data.department || ''}"`,
                    data.duration,
                    data.isUnder18 ? 'Yes' : 'No'
                ];
                csvContent += row.join(",") + "\r\n";
            }
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `roster_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch(e) {
        alert("Failed to export CSV");
    }
}

// Boot up
document.addEventListener('DOMContentLoaded', init);

// Password UI Toggle
window.togglePassword = function(btn) {
    const input = btn.previousElementSibling;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁';
    }
};
