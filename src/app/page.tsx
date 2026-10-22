import '@fontsource/noto-nastaliq-urdu/arabic-700.css';
import { getLocale, getTranslations } from 'next-intl/server';
import s from './home.module.css';

type Item = { title: string; text: string };
type Faq = { q: string; a: string };

const SITE = 'https://therapyfarsi.com';
// Owner's support line (spec 17: WhatsApp is the site's number, for times and connection only).
const WHATSAPP = { link: 'https://wa.me/447514444142', display: '+44 7514 444142', tel: '+447514444142' };

/** A Persian pointed arch opening onto a European street at dusk; one window is lit. */
function ArchWindow({ label }: { label: string }) {
  return (
    <div className={s.arch} role="img" aria-label={label}>
      <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="tf-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1E463D" />
            <stop offset=".45" stopColor="#3C877F" />
            <stop offset=".72" stopColor="#9CC9BF" />
            <stop offset=".86" stopColor="#E8C98E" />
          </linearGradient>
          <radialGradient id="tf-glow">
            <stop offset="0" stopColor="#F6D27A" stopOpacity=".75" />
            <stop offset="1" stopColor="#F6D27A" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="300" height="400" fill="url(#tf-sky)" />
        <circle cx="96" cy="96" r="9" fill="#F7E9C4" />
        <circle cx="210" cy="64" r="1.6" fill="#F7E9C4" opacity=".8" />
        <circle cx="168" cy="120" r="1.2" fill="#F7E9C4" opacity=".6" />
        <g fill="#183A32">
          <path d="M0 400V300L30 262L60 300V400Z" />
          <path d="M55 400V282L87 238L120 282V400Z" />
          <path d="M115 400V300H165V400Z" />
          <path d="M150 300V282H158V300Z" />
          <path d="M160 400V270L195 226L230 270V400Z" />
          <path d="M225 400V296L262 256L300 296V400Z" />
        </g>
        <g fill="#26554A">
          <rect x="22" y="318" width="10" height="14" />
          <rect x="78" y="296" width="10" height="14" />
          <rect x="96" y="330" width="10" height="14" />
          <rect x="128" y="318" width="10" height="14" />
          <rect x="174" y="330" width="10" height="14" />
          <rect x="250" y="312" width="10" height="14" />
          <rect x="270" y="346" width="10" height="14" />
        </g>
        <g className={s.lit}>
          <circle cx="200" cy="296" r="30" fill="url(#tf-glow)" />
          <rect x="193" y="287" width="14" height="18" fill="#F6D27A" />
          <path d="M200 287V305M193 296H207" stroke="#C9973E" strokeWidth="1.2" />
        </g>
        <path d="M244 400C232 342 230 262 244 182C258 262 256 342 244 400Z" fill="#0F2B24" />
        <path d="M38 400C31 362 30 316 38 270C46 316 45 362 38 400Z" fill="#0F2B24" />
      </svg>
    </div>
  );
}

export default async function HomePage() {
  const [t, tMeta, locale] = await Promise.all([getTranslations('home'), getTranslations('meta'), getLocale()]);
  const num = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB');
  const why = t.raw('why') as Item[];
  const steps = t.raw('steps') as Item[];
  const trust = t.raw('trust') as Item[];
  const topics = t.raw('topics') as Item[];
  const story = t.raw('storyBody') as string[];
  const faq = t.raw('faq') as Faq[];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TherapyFarsi',
    alternateName: 'تراپی‌فارسی',
    url: SITE,
    description: tMeta('description'),
    contactPoint: { '@type': 'ContactPoint', telephone: WHATSAPP.tel, contactType: 'customer support', availableLanguage: ['fa', 'en'] },
  };

  return (
    <div className={s.wrap}>
      {/* Shared arch outline for the hero window. */}
      <svg width="0" height="0" className={s.defs} aria-hidden="true">
        <clipPath id="tf-arch" clipPathUnits="objectBoundingBox">
          <path d="M0,1 L0,0.36 C0,0.2 0.22,0.09 0.5,0 C0.78,0.09 1,0.2 1,0.36 L1,1 Z" />
        </clipPath>
      </svg>

      <header className={s.top}>
        <a className={s.brand} href="/">
          <svg viewBox="0 0 26 32" aria-hidden="true">
            <path d="M1 31V12C1 6.5 6.5 3 13 1c6.5 2 12 5.5 12 11v19z" fill="none" stroke="#1A8C8A" strokeWidth="2" />
            <path d="M13 9c-2 4-2.6 9-2.6 13 0 3 1.2 5 2.6 5s2.6-2 2.6-5c0-4-.6-9-2.6-13z" fill="#2F5D50" />
          </svg>
          {t('brand')}
        </a>
        <nav className={s.nav} aria-label={t('brand')}>
          <a href="#why">{t('navWhy')}</a>
          <a href="#how">{t('navHow')}</a>
          <a href="#faq">{t('navFaq')}</a>
        </nav>
        <span className={s.soon}>{t('soon')}</span>
      </header>

      <main>
        <div className={s.hero}>
          <div>
            <h1 className={s.title}>
              <span>{t('heroLine1')}</span>
              <span>{t('heroLine2')}</span>
            </h1>
            <p className={s.lede}>{t('heroLede')}</p>
            <p className={s.status}>{t('heroStatus')}</p>
            <div className={s.actions}>
              <a className={`${s.btn} ${s.primary}`} href="#how">{t('ctaHow')}</a>
              <a className={`${s.btn} ${s.quiet}`} href="#faq">{t('ctaFaq')}</a>
            </div>
          </div>
          <ArchWindow label={t('archLabel')} />
        </div>

        <section id="why" className={s.section} aria-labelledby="why-title">
          <h2 id="why-title" className={s.h2}>{t('whyTitle')}</h2>
          <p className={s.lead}>{t('whyLead')}</p>
          <p className={s.leadBody}>{t('whyBody')}</p>
          <ul className={s.three}>
            {why.map((w) => (
              <li key={w.title}><h3>{w.title}</h3><p>{w.text}</p></li>
            ))}
          </ul>
        </section>

        <section className={s.section} aria-labelledby="topics-title">
          <h2 id="topics-title" className={s.h2}>{t('topicsTitle')}</h2>
          <ul className={s.topics}>
            {topics.map((topic) => (
              <li key={topic.title}><h3>{topic.title}</h3><p>{topic.text}</p></li>
            ))}
          </ul>
          <p className={s.note}>{t('topicsNote')}</p>
        </section>

        <section id="how" className={s.section} aria-labelledby="how-title">
          <h2 id="how-title" className={s.h2}>{t('howTitle')}</h2>
          <ol className={s.steps}>
            {steps.map((step, i) => (
              <li key={step.title}>
                <span className={s.num} aria-hidden="true">{num.format(i + 1)}</span>
                <div><h3>{step.title}</h3><p>{step.text}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section} aria-labelledby="story-title">
          <h2 id="story-title" className={s.h2}>{t('storyTitle')}</h2>
          <div className={s.story}>
            {story.map((para) => <p key={para}>{para}</p>)}
          </div>
        </section>

        <section className={s.section} aria-labelledby="trust-title">
          <h2 id="trust-title" className={s.h2}>{t('trustTitle')}</h2>
          <ul className={s.three}>
            {trust.map((item) => (
              <li key={item.title}><h3>{item.title}</h3><p>{item.text}</p></li>
            ))}
          </ul>
          <p className={s.emergency}>
            <strong>{t('emergencyStrong')}</strong> {t('emergencyText')}
          </p>
        </section>

        <section id="faq" className={s.section} aria-labelledby="faq-title">
          <h2 id="faq-title" className={s.h2}>{t('faqTitle')}</h2>
          <div className={s.faq}>
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <div className={s.contact}>
            <div>
              <h3>{t('contactTitle')}</h3>
              <p>{t('contactText')}</p>
            </div>
            <a className={`${s.btn} ${s.primary}`} href={WHATSAPP.link} target="_blank" rel="noopener noreferrer">
              {t('contactCta')}
            </a>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <span>{t('footerCopy')}</span>
        <span>{t('footerTagline')}</span>
        <a className={s.phone} href={WHATSAPP.link} target="_blank" rel="noopener noreferrer" dir="ltr">
          WhatsApp {WHATSAPP.display}
        </a>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
