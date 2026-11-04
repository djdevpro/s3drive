import { createFileRoute } from '@tanstack/react-router';
import { NotFound } from './-lib/NotFound';

export const Route = createFileRoute('/$')({
  component: NotFound,
});
