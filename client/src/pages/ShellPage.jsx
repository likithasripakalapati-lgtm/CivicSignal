import PageHeading from '../components/ui/PageHeading.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

export default function ShellPage({ titleKey, descriptionKey, emptyTitleKey, emptyDescriptionKey }) {
  return <><PageHeading titleKey={titleKey} descriptionKey={descriptionKey} /><EmptyState titleKey={emptyTitleKey} descriptionKey={emptyDescriptionKey} /></>;
}
