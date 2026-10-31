# Records the Verchestra smoke self-test for the README.
# Requires: vhs (https://github.com/charmbracelet/vhs), Node 24.14.0 or later, git.
# Run:      vhs docs/assets/self-test.tape   ->  writes docs/assets/self-test.gif

Output docs/assets/self-test.gif

Require npx
Require git

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 420
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set WindowBar Colorful

# Off camera: a neutral prompt, an empty working directory (so no home path or
# user name shows), and a warm-up run, so the GIF shows a release that is
# already resolved, verified, and activated instead of minutes of downloading.
Hide
Type `exec env PS1='$ ' bash --norc --noprofile`
Enter
Type `cd "$(mktemp -d)" && clear`
Enter
Type "npx --yes verchestra@0.0.0-qualification.9 --version > /dev/null 2>&1; clear"
Enter
Wait@600s /\$ ?$/
Show

Type "npx verchestra@0.0.0-qualification.9 --version"
Sleep 1s
Enter
Wait@120s /\$ ?$/
Sleep 2s

Type "npx verchestra@0.0.0-qualification.9 self-test --profile smoke"
Sleep 1s
Enter
Wait+Screen@600s /self_test\.verdict/
Sleep 6s
