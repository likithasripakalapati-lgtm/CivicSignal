import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import * as authService from '../services/auth.js';
import * as areasService from '../services/areas.js';
import SettingsPage from './SettingsPage.jsx';

vi.mock('../services/auth.js', () => ({
  getCurrentUser: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock('../services/areas.js', () => ({
  getAreas: vi.fn(),
  getAreaImpact: vi.fn(),
}));

const citizen = {
  id: 'citizen-1',
  email: 'citizen@example.test',
  languagePreference: 'en-IN',
  selectedAreaIds: [],
};
const areaResponse = {
  areas: [
    { id: 'ap-anakapalli', name: 'Anakapalli', level: 'district' },
    { id: 'ap-ananthapuramu', name: 'Ananthapuramu', level: 'district' },
    { id: 'ap-markapuram', name: 'Markapuram', level: 'district' },
    { id: 'ap-polavaram', name: 'Polavaram', level: 'district' },
  ],
};

function renderSettings() {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue(citizen);
  authService.updatePreferences.mockImplementation(async (preferences) => ({
    ...citizen,
    ...preferences,
  }));
  areasService.getAreas.mockResolvedValue(areaResponse);
});

describe('district preference settings', () => {
  it('saves selected district IDs through the existing preferences service', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('checkbox', { name: 'Anakapalli' }));
    await user.click(screen.getByRole('button', { name: 'Save districts' }));

    expect(authService.updatePreferences).toHaveBeenCalledWith({
      selectedAreaIds: ['ap-anakapalli'],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('District preferences saved.');
  });

  it('shows and saves the new district choices by stable application ID', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('checkbox', { name: 'Markapuram' }));
    await user.click(screen.getByRole('checkbox', { name: 'Polavaram' }));
    await user.click(screen.getByRole('button', { name: 'Save districts' }));

    expect(authService.updatePreferences).toHaveBeenCalledWith({
      selectedAreaIds: ['ap-markapuram', 'ap-polavaram'],
    });
  });

  it('renders district selection labels in Telugu', async () => {
    localStorage.setItem('civicsignal.language', 'te-IN');
    authService.getCurrentUser.mockResolvedValue({
      ...citizen,
      languagePreference: 'te-IN',
    });
    renderSettings();

    expect(await screen.findByRole('checkbox', { name: 'అనకాపల్లి' })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'మార్కాపురం' })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'పోలవరం' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'జిల్లాలను భద్రపరచండి' })).toBeInTheDocument();
  });

  it('shows an explicit load error if the district registry is unavailable', async () => {
    areasService.getAreas.mockRejectedValue(new Error('network unavailable'));
    renderSettings();

    expect(await screen.findByRole('alert')).toHaveTextContent('Supported districts could not be loaded.');
  });
});
