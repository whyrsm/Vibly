import { API_URL } from '../config/constants.js';

class ApiClient {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    this.loadTokens();
  }

  loadTokens() {
    chrome.storage.local.get(['accessToken', 'refreshToken', 'user'], (result) => {
      this.accessToken = result.accessToken || null;
      this.refreshToken = result.refreshToken || null;
      this.user = result.user || null;
    });
  }

  async saveTokens(accessToken, refreshToken, user) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.user = user;
    await chrome.storage.local.set({ accessToken, refreshToken, user });
  }

  async clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    await chrome.storage.local.remove(['accessToken', 'refreshToken', 'user']);
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  getUser() {
    return this.user;
  }

  async request(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle token refresh on 401
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        return fetch(url, { ...options, headers });
      }
    }

    return response;
  }

  async refreshAccessToken() {
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!response.ok) {
        await this.clearTokens();
        return false;
      }

      const data = await response.json();
      await this.saveTokens(data.accessToken, data.refreshToken, data.user);
      return true;
    } catch {
      await this.clearTokens();
      return false;
    }
  }

  async register(email, password) {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Registration failed');
    }

    const data = await response.json();
    await this.saveTokens(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async login(email, password) {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }

    const data = await response.json();
    await this.saveTokens(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors
    }
    await this.clearTokens();
  }

  async initRecording(estimatedSize, partCount) {
    const response = await this.request('/api/recordings/init', {
      method: 'POST',
      body: JSON.stringify({ estimatedSize, partCount }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to initialize upload');
    }

    return response.json();
  }

  async completeRecording(recordingId, parts, duration, title) {
    const response = await this.request(`/api/recordings/${recordingId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ parts, duration, title }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to complete upload');
    }

    return response.json();
  }

  async getRecordings() {
    const response = await this.request('/api/recordings');

    if (!response.ok) {
      throw new Error('Failed to fetch recordings');
    }

    return response.json();
  }

  async deleteRecording(recordingId) {
    const response = await this.request(`/api/recordings/${recordingId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete recording');
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();
