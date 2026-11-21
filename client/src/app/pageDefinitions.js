import {
  Activity, Bell, FileClock, FilePlus2, FileText, Headphones, Home, MapPinned, Settings, UserRound,
} from 'lucide-react';
import LandingPage from '../pages/LandingPage.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import SignInPage from '../pages/SignInPage.jsx';
import RegisterPage from '../pages/RegisterPage.jsx';
import UploadPage from '../pages/UploadPage.jsx';
import NoticeDetailsPage from '../pages/NoticeDetailsPage.jsx';
import ImpactMapPage from '../pages/ImpactMapPage.jsx';
import NotificationsPage from '../pages/NotificationsPage.jsx';
import AssistantPage from '../pages/AssistantPage.jsx';
import SettingsPage from '../pages/SettingsPage.jsx';
import HistoryPage from '../pages/HistoryPage.jsx';

export const pageDefinitions = [
  { path: '/', key: 'nav.home', description: 'landing.description', icon: Home, component: LandingPage, public: true },
  { path: '/dashboard', key: 'nav.dashboard', description: 'dashboard.description', icon: Activity, component: DashboardPage },
  { path: '/sign-in', key: 'nav.signIn', description: 'auth.signInDescription', icon: UserRound, component: SignInPage, public: true },
  { path: '/register', key: 'nav.register', description: 'auth.registerDescription', icon: UserRound, component: RegisterPage, public: true },
  { path: '/notices/upload', key: 'nav.upload', description: 'upload.description', icon: FilePlus2, component: UploadPage },
  { path: '/notices/:noticeId', key: 'notice.title', description: 'notice.description', icon: FileText, component: NoticeDetailsPage },
  { path: '/impact-map', key: 'nav.map', description: 'map.description', icon: MapPinned, component: ImpactMapPage },
  { path: '/notifications', key: 'nav.notifications', description: 'notifications.description', icon: Bell, component: NotificationsPage },
  { path: '/assistant', key: 'nav.assistant', description: 'assistant.description', icon: Headphones, component: AssistantPage },
  { path: '/settings', key: 'nav.settings', description: 'settings.description', icon: Settings, component: SettingsPage },
  { path: '/history', key: 'nav.history', description: 'history.description', icon: FileClock, component: HistoryPage },
];

export const primaryNavigation = pageDefinitions.filter(
  (page) => !page.public && !page.path.includes(':'),
);
