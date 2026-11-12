import { signin, signup, routeByRole } from './auth.js';
import { getToken, getProfile, loadConfig } from './api.js';
import { redirect, toast, escapeHtml } from './ui.js';

// Already signed in? Go straight to the right dashboard.
await loadConfig();
if (getToken() && getProfile()) {
  routeByRole(getProfile());
}

const tabSignin = document.getElementById('tabSignin');
const tabSignup = document.getElementById('tabSignup');
const signinForm = document.getElementById('signinForm');
const signupForm = document.getElementById('signupForm');
const alertEl = document.getElementById('authAlert');

function setTab(which) {
  const signin = which === 'signin';
  tabSignin.classList.toggle('active', signin);
  tabSignup.classList.toggle('active', !signin);
  signinForm.classList.toggle('hidden', !signin);
  signupForm.classList.toggle('hidden', signin);
  alertEl.innerHTML = '';
}
tabSignin.addEventListener('click', () => setTab('signin'));
tabSignup.addEventListener('click', () => setTab('signup'));

function alert(message, type = 'error') {
  alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
}

function lockButtons(state) {
  document.getElementById('signinBtn').disabled = !state;
  document.getElementById('signupBtn').disabled = !state;
}

signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.innerHTML = '';
  const email = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPassword').value;
  lockButtons(false);
  try {
    const data = await signin({ email, password });
    toast('Signed in', 'success');
    routeByRole(data.profile);
  } catch (err) {
    alert(err.message || 'Sign in failed.');
    lockButtons(true);
  }
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.innerHTML = '';
  const full_name = document.getElementById('suName').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const password = document.getElementById('suPassword').value;
  lockButtons(false);
  try {
    const data = await signup({ full_name, email, password });
    if (data.access_token) {
      toast('Account created', 'success');
      routeByRole(data.profile);
    } else {
      alert('Account created. Please sign in.', 'success');
      setTab('signin');
      document.getElementById('siEmail').value = email;
      lockButtons(true);
    }
  } catch (err) {
    alert(err.message || 'Sign up failed.');
    lockButtons(true);
  }
});
