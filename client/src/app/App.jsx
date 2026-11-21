import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout.jsx';
import { pageDefinitions } from './pageDefinitions.js';

function PageRoute({ page }) {
  const PageComponent = page.component;
  return <PageComponent />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {pageDefinitions.map((page) => (
          <Route key={page.path} path={page.path} element={<PageRoute page={page} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
