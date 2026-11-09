'use client';

// Emails: the shared inbox and personalised broadcasts. Both send through the mail queue on the
// server (functions/src/mail.ts), which keeps to Resend's daily limit.
import React from 'react';
import { useAuth } from '@/lib/auth';
import { QueryPage } from '@/lib/useQuery';
import { FirestoreMailProvider } from '@/components/mail/MailContext';
import EmailsView from '@/components/mail/EmailsView';

export default function EmailsPage() {
  return <QueryPage><Emails /></QueryPage>;
}

function Emails() {
  const { me } = useAuth();
  return <FirestoreMailProvider me={me}><EmailsView basePath="/emails/" /></FirestoreMailProvider>;
}
