import { signin, signup, routeByRole } from './auth.js';
import { getToken, getProfile, loadConfig } from './api.js';
import { redirect, toast, escapeHtml } from './ui.js';

// Already signed in? Go straight to the right dashboard.
await loadConfig();
if (getToken() && getProfile()) {
  routeByRole(getProfile());
}

const tabSignin  = document.getElementById('tabSignin');
const tabSignup  = document.getElementById('tabSignup');
const signinForm = document.getElementById('signinForm');
const signupForm = document.getElementById('signupForm');
const alertEl    = document.getElementById('authAlert');

// ---- tab switching ----
function setTab(which) {
  const isSignin = which === 'signin';
  tabSignin.classList.toggle('active', isSignin);
  tabSignup.classList.toggle('active', !isSignin);
  signinForm.classList.toggle('hidden', !isSignin);
  signupForm.classList.toggle('hidden', isSignin);
  alertEl.innerHTML = '';
}
tabSignin.addEventListener('click', () => setTab('signin'));
tabSignup.addEventListener('click', () => setTab('signup'));

// ---- role selector ----
let selectedRole = 'customer';

document.getElementById('roleCustomer').addEventListener('click', () => selectRole('customer'));
document.getElementById('roleStaff').addEventListener('click',    () => selectRole('staff'));

function selectRole(role) {
  selectedRole = role;
  document.getElementById('roleCustomer').classList.toggle('selected', role === 'customer');
  document.getElementById('roleStaff').classList.toggle('selected',    role === 'staff');
}

// ---- helpers ----
function showAlert(message, type = 'error') {
  alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
}

function lockButtons(enabled) {
  document.getElementById('signinBtn').disabled = !enabled;
  document.getElementById('signupBtn').disabled = !enabled;
}

// ---- sign in ----
signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.innerHTML = '';
  const email    = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPassword').value;
  lockButtons(false);
  try {
    const data = await signin({ email, password });
    toast('Signed in', 'success');
    routeByRole(data.profile);
  } catch (err) {
    showAlert(err.message || 'Sign in failed.');
    lockButtons(true);
  }
});

// ---- sign up ----
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.innerHTML = '';
  const full_name = document.getElementById('suName').value.trim();
  const email     = document.getElementById('suEmail').value.trim();
  const password  = document.getElementById('suPassword').value;
  const role      = selectedRole;   // 'customer' or 'staff'
  lockButtons(false);
  try {
    const data = await signup({ full_name, email, password, role });
    if (data.access_token) {
      toast(`Account created as ${role}`, 'success');
      routeByRole(data.profile);
    } else {
      showAlert('Account created. Please sign in.', 'success');
      setTab('signin');
      document.getElementById('siEmail').value = email;
      lockButtons(true);
    }
  } catch (err) {
    showAlert(err.message || 'Sign up failed.');
    lockButtons(true);
  }
});
