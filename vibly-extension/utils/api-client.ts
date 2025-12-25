import { API_URL } from './constants';

interface User {
  id: string;
  email: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private user: User | null = null;

  constructor() {
    this.loadTokens();
  }

  private async loadTokens(): Promise<void> {
    const result = await browser.storage.local.get(['accessToken', 'refreshToken', 'user']) as {
      accessToken?: string;
      refreshToken?: string;
      user?: User;
    };
    this.accessToken = result.accessToken || null;
    this.refreshToken = result.refreshToken || null;
    this.user = result.user || null;
  }

  private async saveTokens(accessToken: string, refreshToken: string, user: User): Promise<void> {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.user = user;
    await browser.storage.local.set({ accessToken, refreshToken, user });
  }

  async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    await browser.storage.local.remove(['accessToken', 'refreshToken', 'user']);
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getUser(): User | null {
    return this.user;
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${API_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }
    return response;
  }


  private async refreshAccessToken(): Promise<boolean> {
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
      const data: AuthTokens = await response.json();
      await this.saveTokens(data.accessToken, data.refreshToken, data.user);
      return true;
    } catch {
      await this.clearTokens();
      return false;
    }
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Registration failed');
    }
    const data: AuthTokens = await response.json();
    await this.saveTokens(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }
    const data: AuthTokens = await response.json();
    await this.saveTokens(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {}
    await this.clearTokens();
  }

  async initRecording(estimatedSize: number, partCount: number): Promise<{ recordingId: string; uploadUrls: string[] }> {
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

  async completeRecording(recordingId: string, parts: { partNumber: number; etag: string }[], duration: number, title: string): Promise<{ shareUrl: string }> {
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
}

export const apiClient = new ApiClient();
