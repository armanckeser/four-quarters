import './credit.css';

/**
 * Who made this, where the source is, and what the page collects.
 *
 * One quiet line in the corner, shown only while the machine has the screen to
 * itself: the builder and an opened invite both have something to say, and this
 * should never compete with either. It is the only place the app names its
 * author, which is why the publish gate's personal-domain rule is allowed here
 * and nowhere else.
 */
export function Credit() {
  return (
    <p className="credit">
      Made by{' '}
      <a href="https://armanckeser.com" target="_blank" rel="noopener">
        Armanc Keser
      </a>
      <span aria-hidden="true"> · </span>
      <a href="https://github.com/armanckeser/four-quarters" target="_blank" rel="noopener">
        GitHub
      </a>
      <span aria-hidden="true"> · </span>
      <a href="https://armanckeser.com/privacy#demos" target="_blank" rel="noopener">
        Privacy
      </a>
    </p>
  );
}
