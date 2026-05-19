import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet';

// React 16 RTL auto-cleans; explicit cleanup is harmless and protects
// against any test that leaves an open Radix portal behind.
afterEach(cleanup);

function Harness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="external">
        external
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button" data-testid="trigger">
            Open
          </button>
        </SheetTrigger>
        <SheetContent closeLabel="關閉">
          <SheetHeader>
            <SheetTitle>Detail</SheetTitle>
            <SheetDescription>Body</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </>
  );
}

describe('Sheet primitive', () => {
  it('renders nothing until opened', () => {
    render(<Harness />);
    expect(screen.queryByText('Detail')).not.toBeInTheDocument();
  });

  it('opens when trigger is clicked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Detail')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('closes on ESC keypress', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Detail')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    // Radix removes the content from the DOM on close.
    expect(screen.queryByText('Detail')).not.toBeInTheDocument();
  });

  it('honours the i18n closeLabel for the close button sr-only text', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    // Radix renders the close as a button; the sr-only span holds our label.
    expect(screen.getByText('關閉')).toBeInTheDocument();
  });
});
