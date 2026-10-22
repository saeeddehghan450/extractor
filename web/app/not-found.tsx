'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { t } from '@/lib/i18n';
import { useHeader } from '@/lib/ui';

export default function NotFound() {
  useHeader('404');
  return (
    <div className="card empty">
      <Icon name="alert" />
      <div>404</div>
      <div style={{ marginTop: 14 }}><Link className="btn primary" href="/"><Icon name="activity" />{t('nav.live')}</Link></div>
    </div>
  );
}
