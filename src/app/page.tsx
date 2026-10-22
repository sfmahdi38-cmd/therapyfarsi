import '@fontsource/noto-nastaliq-urdu/arabic-700.css';
import type { CSSProperties, ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Tilt } from './Tilt';
import s from './home.module.css';

type Item = { title: string; text: string };
type Faq = { q: string; a: string };

const SITE = 'https://therapyfarsi.com';
// Owner's support line (spec 17: WhatsApp is the site's number, for times and connection only).
const WHATSAPP = { link: 'https://wa.me/447514444142', display: '+44 7514 444142', tel: '+447514444142' };

/** Depth of the arch frame, drawn as stacked copies of its outline. */
const FRAME_SLICES = 16;

const vars = (v: Record<string, number | string>) => v as CSSProperties;

/** Shapes the hero and cards reuse: arch outline, tile pattern, eight-point star. */
function Defs() {
  return (
    <svg width="0" height="0" className={s.defs} aria-hidden="true">
      <defs>
        <clipPath id="tf-arch" clipPathUnits="objectBoundingBox">
          <path d="M0,1 L0,0.36 C0,0.2 0.21,0.09 0.5,0 C0.79,0.09 1,0.2 1,0.36 L1,1 Z" />
        </clipPath>
        <path
          id="tf-ring"
          fillRule="evenodd"
          d="M0 440V160C0 92 70 40 170 0C270 40 340 92 340 160V440ZM20 420V164C20 104 84 58 170 22C256 58 320 104 320 164V420Z"
        />
        <symbol id="tf-star" viewBox="-10 -10 20 20">
          <rect x="-7.07" y="-7.07" width="14.14" height="14.14" />
          <rect x="-7.07" y="-7.07" width="14.14" height="14.14" transform="rotate(45)" />
        </symbol>
        <pattern id="tf-tile" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#178582" />
          <use href="#tf-star" x="5" y="5" width="14" height="14" fill="#2AA7A3" />
          <use href="#tf-star" x="9" y="9" width="6" height="6" fill="#F1D9A0" />
          <circle cx="0" cy="0" r="1.6" fill="#E2B04A" />
          <circle cx="24" cy="0" r="1.6" fill="#E2B04A" />
          <circle cx="0" cy="24" r="1.6" fill="#E2B04A" />
          <circle cx="24" cy="24" r="1.6" fill="#E2B04A" />
        </pattern>
        <linearGradient id="tf-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#001A18" stopOpacity=".32" />
        </linearGradient>
        <linearGradient id="tf-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123630" />
          <stop offset=".38" stopColor="#2C786F" />
          <stop offset=".64" stopColor="#8DC3B6" />
          <stop offset=".8" stopColor="#F0CF92" />
          <stop offset="1" stopColor="#F2B27A" />
        </linearGradient>
        <radialGradient id="tf-glow">
          <stop offset="0" stopColor="#F6D27A" stopOpacity=".8" />
          <stop offset="1" stopColor="#F6D27A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="tf-moon">
          <stop offset="0" stopColor="#FFF4D6" stopOpacity=".7" />
          <stop offset="1" stopColor="#FFF4D6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tf-tea" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8E2F14" />
          <stop offset=".45" stopColor="#D2602A" />
          <stop offset="1" stopColor="#7A260F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** One layer of the view through the window; nearer layers drift further with the mouse. */
function Layer({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div className={s.layer} style={vars({ '--d': depth })}>
      <svg viewBox="0 0 340 440" preserveAspectRatio="xMidYMid slice">{children}</svg>
    </div>
  );
}

/**
 * A Persian pointed arch in 3D: a tiled frame with real thickness, a European street at dusk
 * receding behind it, and a glass of tea steaming on the sill. One window across the street is lit.
 */
function ArchScene({ label }: { label: string }) {
  return (
    <div className={s.arch} role="img" aria-label={label}>
      <div className={s.stage} aria-hidden="true">
        <div className={s.sway}>
          <div className={s.halo} />

          <div className={s.view}>
            <Layer depth={6}>
              <rect width="340" height="440" fill="url(#tf-sky)" />
              <circle cx="112" cy="118" r="40" fill="url(#tf-moon)" />
              <circle cx="112" cy="118" r="11" fill="#FFF4D6" />
              <g fill="#F7E9C4" className={s.twinkle}>
                <circle cx="226" cy="78" r="1.7" />
                <circle cx="184" cy="140" r="1.2" />
                <circle cx="70" cy="190" r="1.1" />
                <circle cx="268" cy="150" r="1.4" />
                <circle cx="150" cy="60" r="1" />
              </g>
            </Layer>
            <Layer depth={12}>
              <g fill="#3E8377" opacity=".7">
                <path d="M-10 440V318H24V298H40V318H58V440Z" />
                <path d="M66 440V312H82C82 292 98 280 112 280C126 280 142 292 142 312H158V440Z" />
                <path d="M110 280V258H114V280Z" />
                <path d="M174 440V300L196 248L218 300V440Z" />
                <path d="M194 248V230H198V248Z" />
                <path d="M226 440V308H262V290H280V308H302V440Z" />
                <path d="M296 440V296L320 268L350 296V440Z" />
              </g>
            </Layer>
            <Layer depth={20}>
              <g transform="translate(20 40)">
                <g fill="#183A32">
                  <path d="M-40 400V320L-20 290L0 320V400Z" />
                  <path d="M0 400V300L30 262L60 300V400Z" />
                  <path d="M55 400V282L87 238L120 282V400Z" />
                  <path d="M115 400V300H165V400Z" />
                  <path d="M150 300V282H158V300Z" />
                  <path d="M160 400V270L195 226L230 270V400Z" />
                  <path d="M225 400V296L262 256L300 296V400Z" />
                  <path d="M296 400V312L318 286L340 312V400Z" />
                </g>
                <g fill="#2B5E52">
                  <rect x="22" y="318" width="10" height="14" />
                  <rect x="78" y="296" width="10" height="14" />
                  <rect x="96" y="330" width="10" height="14" />
                  <rect x="128" y="318" width="10" height="14" />
                  <rect x="174" y="330" width="10" height="14" />
                  <rect x="250" y="312" width="10" height="14" />
                  <rect x="270" y="346" width="10" height="14" />
                </g>
                <g className={s.lit}>
                  <circle cx="200" cy="296" r="34" fill="url(#tf-glow)" />
                  <rect x="193" y="287" width="14" height="18" fill="#F6D27A" />
                  <path d="M200 287V305M193 296H207" stroke="#C9973E" strokeWidth="1.2" />
                </g>
              </g>
            </Layer>
            <Layer depth={32}>
              <path d="M286 440C272 372 270 280 286 190C302 280 300 372 286 440Z" fill="#0F2B24" />
              <path d="M286 440C286 372 286 280 286 190C302 280 300 372 286 440Z" fill="#1D4A3E" />
              <path d="M314 440C305 390 304 330 314 268C324 330 323 390 314 440Z" fill="#0C241E" />
              <path d="M52 440C43 396 42 346 52 296C62 346 61 396 52 440Z" fill="#0F2B24" />
              <path d="M52 440C52 396 52 346 52 296C62 346 61 396 52 440Z" fill="#1D4A3E" />
            </Layer>
          </div>

          {Array.from({ length: FRAME_SLICES }, (_, i) => (
            <svg key={i} className={s.slice} style={vars({ '--i': i + 1 })} viewBox="0 0 340 440">
              <use href="#tf-ring" fill="currentColor" />
            </svg>
          ))}
          <svg className={s.face} viewBox="0 0 340 440">
            <use href="#tf-ring" fill="url(#tf-tile)" />
            <use href="#tf-ring" fill="url(#tf-shade)" />
            <g fill="none" stroke="#E9C46A">
              <path d="M5 440V161C5 95 73 44 170 5C267 44 335 95 335 161V440" strokeWidth="1.6" />
              <path d="M16 424V163C16 101 82 54 170 18C258 54 324 101 324 163V424H16" strokeWidth="2.4" />
            </g>
            <use href="#tf-star" x="161" y="2" width="18" height="18" fill="#E9C46A" />
            <use href="#tf-star" x="165" y="6" width="10" height="10" fill="#A12C4A" />
          </svg>

          <div className={s.sill}>
            <div className={s.sillTop} />
            <div className={s.sillFront} />
            <svg className={s.tea} viewBox="0 0 40 70">
              <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" className={s.steam}>
                <path d="M16 22C12 16 20 12 16 4" />
                <path d="M24 24C20 18 28 14 24 6" />
              </g>
              <ellipse cx="20" cy="64" rx="17" ry="4" fill="#F4ECDD" />
              <ellipse cx="20" cy="63" rx="12" ry="2.4" fill="#D8CDB8" />
              <path d="M10 28C9 36 13 41 12 47C11 55 14 62 20 62C26 62 29 55 28 47C27 41 31 36 30 28Z" fill="url(#tf-tea)" />
              <path d="M10 28C9 36 13 41 12 47C11 55 14 62 20 62C26 62 29 55 28 47C27 41 31 36 30 28Z" fill="none" stroke="#FCE9C8" strokeOpacity=".7" />
              <path d="M14 33C13 40 16 44 15 50" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              <ellipse cx="20" cy="28" rx="10" ry="2.2" fill="#E9A06A" stroke="#FCE9C8" strokeOpacity=".8" />
            </svg>
            <svg className={s.plant} viewBox="0 0 50 70">
              <g fill="#2F6B4F">
                <circle cx="16" cy="30" r="9" />
                <circle cx="33" cy="28" r="10" />
                <circle cx="25" cy="38" r="9" />
              </g>
              <g fill="#3F8A63">
                <circle cx="20" cy="26" r="5" />
                <circle cx="31" cy="34" r="5" />
              </g>
              <g fill="#D2475E">
                <circle cx="18" cy="17" r="4.5" />
                <circle cx="31" cy="14" r="5" />
                <circle cx="38" cy="22" r="3.6" />
              </g>
              <g fill="#F6C0C8">
                <circle cx="18" cy="17" r="1.4" />
                <circle cx="31" cy="14" r="1.6" />
              </g>
              <path d="M10 44H40L36 68H14Z" fill="#C0683F" />
              <path d="M8 42H42V48H8Z" fill="#D9824F" />
              <path d="M14 52H36" stroke="#E9C46A" strokeWidth="1.4" />
            </svg>
          </div>

          <svg className={`${s.float} ${s.f1}`}><use href="#tf-star" /></svg>
          <svg className={`${s.float} ${s.f2}`}><use href="#tf-star" /></svg>
          <svg className={`${s.float} ${s.f3}`}><use href="#tf-star" /></svg>
          <span className={`${s.spark} ${s.k1}`} />
          <span className={`${s.spark} ${s.k2}`} />
          <span className={`${s.spark} ${s.k3}`} />
        </div>
      </div>
      <div className={s.ground} aria-hidden="true" />
    </div>
  );
}

const icon = (paths: string[]) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {paths.map((d) => <path key={d} d={d} />)}
  </svg>
);

const WHY_ICONS = [
  icon(['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', 'M12 15.2s-3.4-1.9-3.4-4.1a1.8 1.8 0 0 1 3.4-.9 1.8 1.8 0 0 1 3.4.9c0 2.2-3.4 4.1-3.4 4.1z']),
  icon(['M3 11l9-7 9 7', 'M5 9.5V20h14V9.5', 'M10 20v-5.5h4V20']),
  icon(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3.2 2']),
];
const TRUST_ICONS = [
  icon(['M3 7.5h11v9H3z', 'M14 10.5l7-3v9l-7-3', 'M3 3l18 18']),
  icon(['M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M8 11V8a4 4 0 0 1 8 0v3']),
  icon(['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4M16 3v4', 'M9 15.5l2 2 4-4']),
];

function Cards({ items, icons }: { items: Item[]; icons: ReactNode[] }) {
  return (
    <ul className={s.three}>
      {items.map((item, i) => (
        <Tilt as="li" key={item.title} className={s.card}>
          <div className={s.cardInner}>
            <span className={s.icon} aria-hidden="true">{icons[i % icons.length]}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </div>
        </Tilt>
      ))}
    </ul>
  );
}

export default async function HomePage() {
  const [t, tMeta, locale] = await Promise.all([getTranslations('home'), getTranslations('meta'), getLocale()]);
  const num = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB');
  const why = t.raw('why') as Item[];
  const steps = t.raw('steps') as Item[];
  const trust = t.raw('trust') as Item[];
  const topics = t.raw('topics') as string[];
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
      <Defs />

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
        <Tilt className={s.hero}>
          <div className={s.heroText}>
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
          <ArchScene label={t('archLabel')} />
        </Tilt>

        <section id="why" className={s.section} aria-labelledby="why-title">
          <h2 id="why-title" className={s.h2}>{t('whyTitle')}</h2>
          <Cards items={why} icons={WHY_ICONS} />
        </section>

        <section className={s.section} aria-labelledby="topics-title">
          <h2 id="topics-title" className={s.h2}>{t('topicsTitle')}</h2>
          <ul className={s.topics}>
            {topics.map((topic) => <li key={topic}>{topic}</li>)}
          </ul>
          <p className={s.note}>{t('topicsNote')}</p>
        </section>

        <section id="how" className={s.section} aria-labelledby="how-title">
          <h2 id="how-title" className={s.h2}>{t('howTitle')}</h2>
          <ol className={s.steps}>
            {steps.map((step, i) => (
              <li key={step.title}>
                <span className={s.num} aria-hidden="true"><span>{num.format(i + 1)}</span></span>
                <div><h3>{step.title}</h3><p>{step.text}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section} aria-labelledby="trust-title">
          <h2 id="trust-title" className={s.h2}>{t('trustTitle')}</h2>
          <Cards items={trust} icons={TRUST_ICONS} />
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
