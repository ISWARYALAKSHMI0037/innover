import { Link } from 'react-router-dom';
import { EmptyState, useDocTitle } from '../ui.jsx';
import { Search } from 'lucide-react';

export default function NotFound() {
  useDocTitle('Page not found');
  return (
    <div className="container page">
      <EmptyState icon={Search} title="That page does not exist" action={<Link className="btn btn-primary" to="/">Go to the home page</Link>}>
        The link may be mistyped, or the page was moved.
      </EmptyState>
    </div>
  );
}
