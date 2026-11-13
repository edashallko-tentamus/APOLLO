// Sign-in, people and labs (backend: auth, admin and labsetup modules)
import { get, post } from './client.js';

export const authState = () => get('/auth/state', { fresh: true });
export const login = (username, password) => post('/auth/login', { username, password });
export const setupAdmin = (username, password, confirm) => post('/auth/setup', { username, password, confirm });
export const changePassword = (current, password, confirm) => post('/auth/change-password', { current, password, confirm });
export const logout = () => post('/auth/logout');

// Every person with their labs, groups and permissions per lab (used for can() and the lab switcher)
export const listUsers = ({ fresh = false } = {}) => get('/users', { fresh });
export const publicSettings = () => get('/public/settings');
