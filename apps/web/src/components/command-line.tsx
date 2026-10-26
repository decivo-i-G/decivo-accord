import styles from './command-line.module.css'
import { CopyButton } from './copy-button'

/**
 * A terminal command in one line with a copy button, as on a developer docs page. The button's name
 * carries the command ("Befehl kopieren: accord figma status"), so a list of buttons tells them apart.
 */
export function CommandLine({ command, label }: { command: string; label: string }) {
  return (
    <div className={styles.command}>
      <span className={styles.prompt} aria-hidden="true">
        $
      </span>
      <code>{command}</code>
      <CopyButton value={command} label={label} detail={command} />
    </div>
  )
}

/**
 * A few lines to paste into a file (a YAML block), with a copy button, as on a developer docs page.
 * `label` names what is copied and where it goes ("YAML für accord.config.yaml kopieren").
 */
export function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className={styles.snippet}>
      <pre>
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label={label} />
    </div>
  )
}
