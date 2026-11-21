import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import * as authService from '../services/auth.js';
import * as areasService from '../services/areas.js';
import ImpactMapPage from './ImpactMapPage.jsx';

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

function renderImpact() {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <MemoryRouter><ImpactMapPage /></MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue({
    id: 'citizen-1',
    email: 'citizen@example.test',
    languagePreference: 'en-IN',
    selectedAreaIds: ['ap-ananthapuramu'],
  });
  areasService.getAreas.mockResolvedValue({
    areas: [{ id: 'ap-ananthapuramu', name: 'Ananthapuramu', level: 'district' }],
  });
});

describe('district notice impact list', () => {
  it('shows explicit district mentions with evidence and page references, without claiming impact', async () => {
    areasService.getAreaImpact.mockResolvedValue({
      area: { id: 'ap-ananthapuramu', name: 'Ananthapuramu', level: 'district' },
      areaId: 'ap-ananthapuramu',
      notices: [{
        noticeId: 'notice-1',
        districtId: 'ap-ananthapuramu',
        filename: 'notice.pdf',
        impactStatus: 'district_mentioned',
        matches: [{
          evidence: 'The notice explicitly mentions Ananthapuramu district.',
          pageNumber: 4,
        }],
        unresolvedLocations: [],
      }],
    });
    renderImpact();

    expect(await screen.findByText('District explicitly mentioned in notice text')).toBeInTheDocument();
    expect(screen.getByText('The notice explicitly mentions Ananthapuramu district.')).toBeInTheDocument();
    expect(screen.getByText('Source document, page 4')).toBeInTheDocument();
    expect(screen.getByText('A district mention alone does not establish geographic impact.')).toBeInTheDocument();
    expect(screen.getByText(/Map display is deferred until an official district-boundary dataset is verified/)).toBeInTheDocument();
  });

  it('labels unresolved locations and explicitly cautions against interpreting omissions', async () => {
    areasService.getAreaImpact.mockResolvedValue({
      area: { id: 'ap-ananthapuramu', name: 'Ananthapuramu', level: 'district' },
      notices: [
        {
          noticeId: 'notice-2',
          districtId: 'ap-ananthapuramu',
          filename: 'unclear.pdf',
          impactStatus: 'unresolved',
          matches: [],
          unresolvedLocations: [{
            location: {
              evidence: 'Residents near the reservoir should take note.',
              pageNumber: 2,
            },
          }],
        },
        {
          noticeId: 'notice-3',
          districtId: 'ap-ananthapuramu',
          filename: 'other-district.pdf',
          impactStatus: 'not_explicitly_listed',
          matches: [],
          unresolvedLocations: [],
        },
        {
          noticeId: 'notice-3',
          districtId: 'ap-ananthapuramu',
          filename: 'other-district.pdf',
          impactStatus: 'unknown',
          matches: [],
          unresolvedLocations: [],
        },
      ],
    });
    renderImpact();

    expect(await screen.findByText('Location could not be matched to a supported district')).toBeInTheDocument();
    expect(screen.getByText('Residents near the reservoir should take note.')).toBeInTheDocument();
    expect(screen.getByText(/this is not a conclusion about impact/)).toBeInTheDocument();
    expect(screen.getByText('Location analysis is unavailable; no impact conclusion can be drawn.')).toBeInTheDocument();
    expect(screen.getAllByText('other-district.pdf')).toHaveLength(1);
  });

  it('renders one notice entry with distinct evidence quotes and deduplicated citation pages', async () => {
    const repeatedQuote = 'Water service work is scheduled for Markapuram.';
    areasService.getAreaImpact.mockResolvedValue({
      area: { id: 'ap-ananthapuramu', name: 'Ananthapuramu', level: 'district' },
      notices: [
        {
          noticeId: 'notice-duplicate',
          districtId: 'ap-ananthapuramu',
          filename: 'govt.notice.pdf',
          impactStatus: 'district_mentioned',
          matches: [
            { evidence: repeatedQuote, pageNumber: 2 },
            { evidence: repeatedQuote, pageNumber: 2 },
            { evidence: repeatedQuote, pageNumber: 3 },
            { evidence: 'Residents must follow the listed schedule.', pageNumber: 4 },
          ],
          unresolvedLocations: [],
        },
        {
          noticeId: 'notice-duplicate',
          districtId: 'ap-ananthapuramu',
          filename: 'govt.notice.pdf',
          impactStatus: 'district_mentioned',
          matches: [
            { evidence: 'Work hours are listed in the following table.', pageNumber: 5 },
          ],
          unresolvedLocations: [],
        },
      ],
    });
    renderImpact();

    expect(await screen.findAllByText('govt.notice.pdf')).toHaveLength(1);
    expect(screen.getAllByText(repeatedQuote)).toHaveLength(1);
    expect(screen.getByText('Residents must follow the listed schedule.')).toBeInTheDocument();
    expect(screen.getByText('Work hours are listed in the following table.')).toBeInTheDocument();
    expect(screen.getAllByText('Source document, page 2')).toHaveLength(1);
    expect(screen.getByText('Source document, page 3')).toBeInTheDocument();
    expect(screen.getByText('Source document, page 4')).toBeInTheDocument();
    expect(screen.getByText('Source document, page 5')).toBeInTheDocument();
  });

  it('groups by district and notice ID, preserving separate same-name uploads and distinct statuses', async () => {
    areasService.getAreas.mockResolvedValue({
      areas: [
        { id: 'ap-markapuram', name: 'Markapuram', level: 'district' },
        { id: 'ap-polavaram', name: 'Polavaram', level: 'district' },
      ],
    });
    authService.getCurrentUser.mockResolvedValue({
      id: 'citizen-1',
      email: 'citizen@example.test',
      languagePreference: 'en-IN',
      selectedAreaIds: ['ap-markapuram', 'ap-polavaram'],
    });
    const explicitNotice = {
      noticeId: '507f1f77bcf86cd799439011',
      districtId: 'ap-markapuram',
      filename: 'govt.notice.pdf',
      impactStatus: 'district_mentioned',
      matches: [{ evidence: 'The notice names Markapuram.', pageNumber: 2 }],
      unresolvedLocations: [],
    };
    const sameNoticeDuplicate = {
      ...explicitNotice,
      noticeId: '507F1F77BCF86CD799439011',
      impactStatus: 'unresolved',
      matches: [],
      unresolvedLocations: [{
        status: 'unresolved',
        location: { evidence: 'Residents near a site should take note.', pageNumber: 3 },
      }],
    };
    const separateUpload = {
      noticeId: '507f1f77bcf86cd799439012',
      districtId: 'ap-markapuram',
      filename: 'govt.notice.pdf',
      impactStatus: 'not_explicitly_listed',
      matches: [],
      unresolvedLocations: [],
    };
    areasService.getAreaImpact.mockImplementation(async (districtId) => ({
      area: { id: districtId, name: districtId, level: 'district' },
      notices: districtId === 'ap-markapuram'
        ? [explicitNotice, sameNoticeDuplicate, separateUpload]
        : [{
          ...explicitNotice,
          districtId: 'ap-polavaram',
          impactStatus: 'unknown',
          matches: [],
        }],
    }));

    renderImpact();

    expect(await screen.findAllByText('govt.notice.pdf')).toHaveLength(3);
    expect(screen.getAllByText('Notice reference: 99439011')).toHaveLength(2);
    expect(screen.getByText('Notice reference: 99439012')).toBeInTheDocument();
    expect(screen.getByText('The notice names Markapuram.')).toBeInTheDocument();
    expect(screen.getByText('Residents near a site should take note.')).toBeInTheDocument();
    expect(screen.getByText(/this is not a conclusion about impact/)).toBeInTheDocument();
    expect(screen.getByText('Location analysis is unavailable; no impact conclusion can be drawn.')).toBeInTheDocument();
  });

  it('links users to settings if no districts are selected', async () => {
    authService.getCurrentUser.mockResolvedValue({
      id: 'citizen-1',
      email: 'citizen@example.test',
      languagePreference: 'en-IN',
      selectedAreaIds: [],
    });
    renderImpact();

    expect(await screen.findByText(/Choose one or more Andhra Pradesh districts/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose districts' })).toHaveAttribute('href', '/settings');
  });
});
