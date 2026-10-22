import './home.css';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, Award, Bell, Briefcase, CheckCircle2, ChevronDown, Clock, CloudRain, Compass,
  Globe, HeartHandshake, Lock, MessageCircle, Moon, RefreshCw, ShieldCheck, Sparkles, UserCheck, Users,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

type Item = { title: string; text: string };
type Faq = { q: string; a: string };

const SITE = 'https://therapyfarsi.com';
// Owner's support line (spec 17: WhatsApp is the site's number, for times and connection only).
const WHATSAPP = { number: '447514444142', display: '+44 7514 444142', tel: '+447514444142' };
const wa = (prefill?: string) =>
  `https://wa.me/${WHATSAPP.number}${prefill ? `?text=${encodeURIComponent(prefill)}` : ''}`;

// One icon per topic, in the order of messages.home.topics.
const TOPIC_ICONS: LucideIcon[] = [Compass, Users, Sparkles, CloudRain, HeartHandshake, Briefcase, Globe, Moon];
const TRUST_ICONS: LucideIcon[] = [Lock, Award, RefreshCw];

const eyebrow = 'inline-block text-xs font-bold text-[#C86D44] bg-[#C86D44]/10 px-3 py-1 rounded-full';
const h2 = 'text-2xl sm:text-4xl font-extrabold text-[#163B35] leading-snug';

/** Window onto a European street at dusk, with a cup of tea on the sill. */
function DuskWindow({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 300 200" className="w-full h-44 mx-auto" role="img" aria-label={label}>
      <circle cx="240" cy="45" r="18" fill="#F2B895" opacity="0.9" />
      <circle cx="248" cy="40" r="16" fill="#163B35" />
      <circle cx="70" cy="40" r="2" fill="#FAF7F2" opacity="0.6" />
      <circle cx="120" cy="25" r="1.5" fill="#FAF7F2" opacity="0.5" />
      <circle cx="180" cy="55" r="2" fill="#FAF7F2" opacity="0.7" />
      <path d="M0 160 L40 160 L40 125 L65 110 L90 125 L90 160 L130 160 L130 115 L160 95 L190 115 L190 160 L300 160 L300 200 L0 200 Z" fill="#0F2925" />
      <rect x="52" y="132" width="10" height="14" rx="2" fill="#F2B895" opacity="0.85" />
      <rect x="68" y="132" width="10" height="14" rx="2" fill="#F2B895" opacity="0.85" />
      <rect x="148" y="122" width="12" height="16" rx="2" fill="#E8996B" opacity="0.9" />
      <rect x="165" y="122" width="12" height="16" rx="2" fill="#E8996B" opacity="0.9" />
      <path d="M135 162 Q150 185 165 162 Z" fill="#C86D44" />
      <path d="M145 152 Q142 142 148 135" stroke="#FAF7F2" strokeWidth="1.5" fill="none" opacity="0.6" />
      <path d="M155 150 Q158 140 152 132" stroke="#FAF7F2" strokeWidth="1.5" fill="none" opacity="0.6" />
    </svg>
  );
}

export default async function HomePage() {
  const [t, tMeta, locale] = await Promise.all([getTranslations('home'), getTranslations('meta'), getLocale()]);
  const num = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB');
  const heroTrust = t.raw('heroTrust') as string[];
  const whyChips = t.raw('whyChips') as string[];
  const topics = t.raw('topics') as Item[];
  const regions = t.raw('teamRegions') as string[];
  const steps = t.raw('steps') as Item[];
  const story = t.raw('storyBody') as string[];
  const trust = t.raw('trust') as Item[];
  const faq = t.raw('faq') as Faq[];
  const notifyLink = wa(t('notifyPrefill'));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TherapyFarsi',
    alternateName: 'تراپی‌فارسی',
    url: SITE,
    description: tMeta('description'),
    contactPoint: { '@type': 'ContactPoint', telephone: WHATSAPP.tel, contactType: 'customer support', availableLanguage: ['fa', 'en'] },
  };

  const nav = [
    ['#why-farsi', t('navWhy')], ['#topics', t('navTopics')], ['#team', t('navTeam')],
    ['#how-it-works', t('navHow')], ['#our-story', t('navStory')], ['#faq', t('navFaq')],
  ] as const;

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1E2A27] antialiased selection:bg-[#1D4E46] selection:text-white">
      {/* Top bar */}
      <div className="bg-[#163B35] text-[#E9F0EE] text-xs sm:text-sm py-2.5 px-4">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#D98A5F] shrink-0" aria-hidden />
          <span>{t('topBar')}</span>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#FAF7F2]/90 backdrop-blur-md border-b border-[#E6DFD3]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-[#1D4E46] flex items-center justify-center shadow-sm">
              <HeartHandshake className="w-6 h-6 text-[#F2B895]" aria-hidden />
            </span>
            <span>
              <span className="text-xl font-extrabold text-[#163B35] block leading-none">{t('brand')}</span>
              <span className="text-[11px] text-stone-500 font-medium mt-1 block" dir="ltr">{t('domainLabel')}</span>
            </span>
          </a>
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-stone-700" aria-label={t('brand')}>
            {nav.map(([href, label]) => (
              <a key={href} href={href} className="hover:text-[#1D4E46] transition">{label}</a>
            ))}
          </nav>
          <a
            href={notifyLink} target="_blank" rel="noopener noreferrer"
            className="bg-[#1D4E46] hover:bg-[#163B35] text-white text-xs sm:text-sm font-semibold px-4 sm:px-5 py-2.5 rounded-xl shadow-sm transition flex items-center gap-2"
          >
            <Bell className="w-4 h-4 text-[#F2B895]" aria-hidden />
            <span>{t('headerCta')}</span>
          </a>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="pt-10 pb-16 sm:py-20 border-b border-[#E6DFD3]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 bg-[#EFE9DE] text-[#1D4E46] px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold border border-[#DED5C5]">
                <span className="w-2 h-2 rounded-full bg-[#C86D44] motion-safe:animate-pulse" aria-hidden />
                <span>{t('heroBadge')}</span>
              </div>
              <h1 className="text-3xl sm:text-5xl lg:text-[52px] font-extrabold text-[#163B35] leading-[1.35]">
                {t('heroBefore')}{' '}
                <span className="text-[#C86D44] underline decoration-[#E8C5B0] decoration-wavy decoration-2 underline-offset-8">
                  {t('heroAccent')}
                </span>{' '}
                {t('heroAfter')}
              </h1>
              <p className="text-base sm:text-lg text-stone-600 leading-relaxed max-w-2xl">{t('heroLede')}</p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-2">
                <a
                  href={notifyLink} target="_blank" rel="noopener noreferrer"
                  className="bg-[#1D4E46] hover:bg-[#143832] text-white font-bold px-7 py-4 rounded-2xl shadow-md hover:shadow-lg transition flex items-center justify-center gap-2.5 text-base"
                >
                  <Bell className="w-5 h-5 text-[#F2B895]" aria-hidden />
                  <span>{t('ctaNotify')}</span>
                </a>
                <a
                  href="#how-it-works"
                  className="bg-white hover:bg-[#F3EDE2] text-[#163B35] border border-[#D5CBB8] font-semibold px-6 py-4 rounded-2xl transition flex items-center justify-center gap-2 text-base"
                >
                  <Sparkles className="w-5 h-5 text-[#C86D44]" aria-hidden />
                  <span>{t('ctaHow')}</span>
                </a>
              </div>
              <ul className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 border-t border-[#E6DFD3] text-xs sm:text-sm text-stone-600">
                {heroTrust.map((item, i) => {
                  const Icon = [CheckCircle2, Clock, Lock][i] ?? CheckCircle2;
                  return (
                    <li key={item} className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-[#1D4E46] shrink-0" aria-hidden />
                      <span>{item}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="lg:col-span-5">
              <div className="mx-auto max-w-md bg-linear-to-b from-[#1D4E46] to-[#12302B] rounded-[36px] p-6 sm:p-8 text-white shadow-2xl border-4 border-[#EFE9DE]">
                <div className="bg-[#163B35] rounded-t-full rounded-b-2xl p-6 border border-teal-700/50 overflow-hidden">
                  <DuskWindow label={t('illusLabel')} />
                  <div className="text-center mt-2">
                    <p className="text-sm text-[#F2B895] font-semibold">{t('cardQuote')}</p>
                    <p className="text-xs text-teal-100/80 mt-1">{t('cardSub')}</p>
                  </div>
                </div>
                <div className="mt-5 bg-[#FAF7F2] text-[#1E2A27] rounded-2xl p-4 shadow-md flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl bg-[#C86D44] text-white flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5" aria-hidden />
                    </span>
                    <div>
                      <div className="text-xs text-stone-500">{t('soonLabel')}</div>
                      <div className="font-bold text-sm text-[#163B35]">{t('soonTitle')}</div>
                      <div className="text-xs text-[#1D4E46] font-medium mt-0.5">{t('soonText')}</div>
                    </div>
                  </div>
                  <a
                    href={notifyLink} target="_blank" rel="noopener noreferrer"
                    className="bg-[#1D4E46] hover:bg-[#163B35] text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl transition shrink-0"
                  >
                    {t('soonCta')}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Why Persian */}
        <section id="why-farsi" className="py-16 sm:py-20 bg-[#F3EDE2]/70 border-b border-[#E6DFD3] scroll-mt-24">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 grid md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-5 space-y-4">
              <span className={eyebrow}>{t('whyTitle')}</span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#163B35] leading-snug">{t('whyLead')}</h2>
              <p className="text-stone-600 text-sm sm:text-base leading-relaxed">{t('whyIntro')}</p>
            </div>
            <div className="md:col-span-7 bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-[#E6DFD3] space-y-4 leading-relaxed">
              <p className="text-base sm:text-lg font-medium text-[#163B35]">{t('whyQuote')}</p>
              <p className="text-sm sm:text-base text-stone-600">{t('whyBody')}</p>
              <ul className="pt-2 flex flex-wrap gap-2.5">
                {whyChips.map((chip) => (
                  <li key={chip} className="bg-[#FAF7F2] border border-[#E6DFD3] text-[#1D4E46] text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                    {chip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Topics */}
        <section id="topics" className="py-16 sm:py-20 max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <span className={eyebrow}>{t('topicsEyebrow')}</span>
            <h2 className={h2}>{t('topicsTitle')}</h2>
          </div>
          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topics.map((topic, i) => {
              const Icon = TOPIC_ICONS[i] ?? Compass;
              return (
                <li key={topic.title} className="p-5 rounded-2xl border border-[#E6DFD3] bg-white">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#F3EDE2] text-[#1D4E46] mb-3">
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                  <h3 className="font-bold text-base sm:text-lg mb-1.5">{topic.title}</h3>
                  <p className="text-xs sm:text-sm leading-relaxed text-stone-600">{topic.text}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-center text-sm text-stone-600">{t('topicsNote')}</p>
        </section>

        {/* Counsellors (real ones are introduced when they join) */}
        <section id="team" className="py-16 sm:py-20 bg-[#F3EDE2]/60 border-y border-[#E6DFD3] scroll-mt-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <span className="inline-block text-xs font-bold text-[#1D4E46] bg-[#1D4E46]/10 px-3 py-1 rounded-full">
                {t('teamEyebrow')}
              </span>
              <h2 className={h2}>{t('teamTitle')}</h2>
              <p className="text-sm sm:text-base text-stone-600 leading-relaxed">{t('teamText')}</p>
              <ul className="flex flex-wrap gap-2.5 pt-1">
                {regions.map((r) => (
                  <li key={r} className="bg-white border border-[#DED5C5] text-[#163B35] text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#C86D44]" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-5 bg-white rounded-3xl p-6 sm:p-7 border border-[#E6DFD3] shadow-sm">
              <span className="w-12 h-12 rounded-2xl bg-[#1D4E46] text-[#F2B895] flex items-center justify-center mb-4">
                <UserCheck className="w-6 h-6" aria-hidden />
              </span>
              <h3 className="text-lg font-extrabold text-[#163B35]">{t('joinTitle')}</h3>
              <p className="text-sm text-stone-600 leading-relaxed mt-1.5">{t('joinText')}</p>
              <a
                href={wa(t('joinPrefill'))} target="_blank" rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 bg-[#C86D44] hover:bg-[#b55e37] text-white text-sm font-bold px-5 py-3 rounded-xl transition"
              >
                <MessageCircle className="w-4 h-4" aria-hidden />
                {t('joinCta')}
              </a>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-16 sm:py-20 max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className={eyebrow}>{t('howEyebrow')}</span>
            <h2 className={h2}>{t('howTitle')}</h2>
            <p className="text-sm sm:text-base text-stone-600">{t('howSub')}</p>
          </div>
          <ol className="mt-12 grid md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <li key={step.title} className="bg-white rounded-3xl p-7 border border-[#E6DFD3] shadow-sm">
                <span className="w-12 h-12 rounded-2xl bg-[#1D4E46] text-[#F2B895] font-extrabold text-xl flex items-center justify-center mb-5">
                  {num.format(i + 1)}
                </span>
                <h3 className="text-lg font-extrabold text-[#163B35] mb-2">{step.title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Our story + safety */}
        <section id="our-story" className="py-16 sm:py-20 bg-[#163B35] text-white scroll-mt-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <span className="inline-block text-xs font-bold text-[#F2B895] bg-white/10 px-3.5 py-1.5 rounded-full">
                {t('storyEyebrow')}
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold leading-snug">{t('storyTitle')}</h2>
              {story.map((para) => (
                <p key={para} className="text-teal-100/90 text-sm sm:text-base leading-relaxed">{para}</p>
              ))}
            </div>
            <div className="lg:col-span-6 bg-[#FAF7F2] text-[#1E2A27] rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-2xl bg-[#C86D44]/15 text-[#C86D44] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-7 h-7" aria-hidden />
                </span>
                <div>
                  <h3 className="text-xl font-extrabold text-[#163B35]">{t('safetyTitle')}</h3>
                  <p className="text-xs text-stone-500">{t('safetySub')}</p>
                </div>
              </div>
              <ul className="space-y-4">
                {trust.map((item, i) => {
                  const Icon = TRUST_ICONS[i] ?? Lock;
                  return (
                    <li key={item.title} className="flex items-start gap-3.5">
                      <Icon className="w-5 h-5 text-[#1D4E46] shrink-0 mt-1" aria-hidden />
                      <div>
                        <h4 className="font-bold text-sm text-[#163B35]">{item.title}</h4>
                        <p className="text-xs text-stone-600 leading-relaxed mt-0.5">{item.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-16 sm:py-20 max-w-4xl mx-auto px-4 sm:px-6 scroll-mt-24">
          <div className="text-center space-y-2 mb-10">
            <span className={eyebrow}>{t('faqEyebrow')}</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#163B35]">{t('faqTitle')}</h2>
            <p className="text-sm text-stone-600">{t('faqSub')}</p>
          </div>
          <div className="space-y-3">
            {faq.map((item, i) => (
              <details key={item.q} open={i === 0} className="group bg-white rounded-2xl border border-[#E6DFD3] overflow-hidden">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden p-5 flex items-center justify-between gap-4 font-bold text-sm sm:text-base text-[#163B35] hover:bg-stone-50/60 transition">
                  <span>{item.q}</span>
                  <ChevronDown className="w-5 h-5 text-stone-400 shrink-0 transition-transform group-open:rotate-180 group-open:text-[#C86D44]" aria-hidden />
                </summary>
                <p className="px-5 pb-5 pt-3 text-xs sm:text-sm text-stone-600 leading-relaxed border-t border-stone-100">{item.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-12 bg-[#EFE9DE] rounded-3xl p-6 sm:p-8 border border-[#DED5C5] flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center sm:text-start">
              <h3 className="text-lg font-extrabold text-[#163B35]">{t('contactTitle')}</h3>
              <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">{t('contactText')}</p>
            </div>
            <a
              href={wa()} target="_blank" rel="noopener noreferrer"
              className="bg-[#1D4E46] hover:bg-[#163B35] text-white text-xs sm:text-sm font-bold px-5 py-3.5 rounded-xl flex items-center gap-2 shadow-sm transition shrink-0"
            >
              <MessageCircle className="w-4 h-4 text-[#F2B895]" aria-hidden />
              <span>{t('contactCta')}</span>
            </a>
          </div>
        </section>
      </main>

      {/* Footer + emergency notice */}
      <footer className="bg-[#122D28] text-teal-100/80 pt-12 pb-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="bg-amber-950/40 border border-amber-700/40 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm text-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
            <p className="leading-relaxed"><strong className="text-white">{t('emergencyStrong')}</strong> {t('emergencyText')}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 border-b border-teal-800/60 pb-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 text-white font-extrabold text-lg">
                <HeartHandshake className="w-6 h-6 text-[#F2B895]" aria-hidden />
                <span>{t('brand')}</span>
              </div>
              <p className="text-xs text-teal-200/70 leading-relaxed">{t('footerDesc')}</p>
            </div>
            <div className="text-xs">
              <div className="font-bold text-white text-sm mb-2">{t('footerLinks')}</div>
              <ul className="space-y-2">
                {nav.map(([href, label]) => (
                  <li key={href}><a href={href} className="hover:text-white transition">{label}</a></li>
                ))}
              </ul>
            </div>
            <div className="text-xs space-y-2">
              <div className="font-bold text-white text-sm mb-2">{t('footerContact')}</div>
              <p>
                {t('footerWhatsapp')}{' '}
                <a href={wa()} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-white hover:underline">{WHATSAPP.display}</a>
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-teal-200/60">
            <p>{t('footerCopy')}</p>
            <p>{t('footerNote')}</p>
          </div>
        </div>
      </footer>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
