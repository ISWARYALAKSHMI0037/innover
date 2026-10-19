import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import Analyze from './pages/Analyze.jsx';
import Result from './pages/Result.jsx';
import History from './pages/History.jsx';
import Placement from './pages/Placement.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="analyze" element={<Analyze />} />
        <Route path="analysis/:id" element={<Result />} />
        <Route path="history" element={<History />} />
        <Route path="placement" element={<Placement />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
