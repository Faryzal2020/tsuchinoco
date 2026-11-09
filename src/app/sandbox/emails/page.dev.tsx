'use client';

// The Emails page on sample mail (see SandboxMailProvider in the sandbox layout).
import React from 'react';
import { QueryPage } from '@/lib/useQuery';
import EmailsView from '@/components/mail/EmailsView';

export default function SandboxEmails() {
  return <QueryPage><EmailsView basePath="/sandbox/emails/" /></QueryPage>;
}
