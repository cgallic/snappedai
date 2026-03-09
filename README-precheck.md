
# Pre-check any message before posting
echo 'Usage: node pre-check.cjs "message text" && telegram-post.sh'
echo 'Always run pre-check before public announcements'
echo ''
echo 'Integration examples:'
echo 'if node pre-check.cjs "$msg" 2>/dev/null; then post_to_tg "$msg"; else echo "Fix issues first"; fi'


# Message Discipline Filter Usage:
# Before sending any status to Connor:
if node /var/www/snap/message-filter.cjs "Your message here" 2>/dev/null; then
    # Send the message
    echo "Message has value"
else
    # Keep it internal
    echo "Filtered: process narration"
fi

