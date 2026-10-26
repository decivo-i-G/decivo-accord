import { getTranslations } from 'next-intl/server'
import { StepDot } from './brand-dots'
import { CommandLine } from './command-line'
import styles from './home.module.css'
import { ArrowRight, BookOpen, type SurfaceTool, ToolIcon } from './icons'

const TOOLS: SurfaceTool[] = ['figma', 'pen', 'claude_design', 'code']

/** First run without projects: what Accord is in one sentence, then the three steps to the first project. */
export async function Onboarding() {
  const t = await getTranslations('home')
  const env = `ACCORD_PROJECTS='[{"slug":"shop","name":"acme/shop","root":"${t('onboarding.root')}"}]'`
  const steps = [
    { key: 'step1', command: 'accord init', copy: t('onboarding.copy') },
    { key: 'step2', command: env, copy: t('onboarding.copyEnv') },
    { key: 'step3', command: 'pnpm --filter @decivo/accord-web dev', copy: t('onboarding.copy') },
  ] as const

  return (
    <section className={styles.onboarding} aria-labelledby="onboarding-h">
      <div className={styles.intro}>
        <h2 id="onboarding-h" className={styles.onboardingTitle}>
          {t('onboarding.title')}
        </h2>
        <p className={styles.onboardingLead}>{t('onboarding.lead')}</p>
        <div className={styles.flow}>
          <ul className={styles.flowTools} aria-label={t('onboarding.flow')}>
            {TOOLS.map((tool) => (
              <li key={tool}>
                <ToolIcon tool={tool} aria-hidden="true" />
                {t(`tools.${tool}`)}
              </li>
            ))}
          </ul>
          <ArrowRight aria-hidden="true" className={styles.flowArrow} />
          <p className={styles.flowTarget}>
            <BookOpen aria-hidden="true" />
            {t('onboarding.flowTarget')}
          </p>
        </div>
      </div>

      <h3 className={styles.stepsTitle}>{t('onboarding.stepsTitle')}</h3>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={step.key} className={styles.step}>
            <span className={styles.stepMarker}>
              <StepDot index={i + 1} />
            </span>
            <div className={styles.stepBody}>
              <h4>{t(`onboarding.${step.key}.title`)}</h4>
              <p>{t(`onboarding.${step.key}.text`)}</p>
              <CommandLine command={step.command} label={step.copy} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
