# Mod Commands Implementation for TG Bot
# Request #24 - 6 votes

## Admin User IDs (hardcoded for security)
const ADMIN_IDS = [
  '1777076101',  // Howler (request originator)
  // Add more admin IDs here as Connor approves
];

## Functions to add to telegram-bot.cjs:

```javascript
// Admin verification
async function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// Ban user
async function banUser(chatId, userId, reason = '') {
  try {
    const response = await fetch(`${API}/banChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        user_id: userId,
        until_date: 0 // Permanent ban
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Ban error:', error);
    return { ok: false };
  }
}

// Unban user  
async function unbanUser(chatId, userId) {
  try {
    const response = await fetch(`${API}/unbanChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        user_id: userId,
        only_if_banned: true
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Unban error:', error);
    return { ok: false };
  }
}

// Mute user (restrict permissions)
async function muteUser(chatId, userId, duration = 3600) { // 1 hour default
  try {
    const until = Math.floor(Date.now() / 1000) + duration;
    const response = await fetch(`${API}/restrictChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        user_id: userId,
        until_date: until,
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false
        }
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Mute error:', error);
    return { ok: false };
  }
}

// Unmute user (restore permissions)
async function unmuteUser(chatId, userId) {
  try {
    const response = await fetch(`${API}/restrictChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        user_id: userId,
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: false,
          can_invite_users: true,
          can_pin_messages: false
        }
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Unmute error:', error);
    return { ok: false };
  }
}

// Commands to add in the message handler:

// /ban @user or reply to message
if (textLower.startsWith('/ban')) {
  if (!await isAdmin(userId)) {
    await reply(chatId, '❌ Admin access required');
    return;
  }
  
  let targetUserId = null;
  let targetUsername = 'user';
  
  // Check if replying to a message
  if (update.message.reply_to_message) {
    targetUserId = update.message.reply_to_message.from.id;
    targetUsername = update.message.reply_to_message.from.username || update.message.reply_to_message.from.first_name;
  } else {
    // Extract username from command
    const match = text.match(/@(\w+)/);
    if (!match) {
      await reply(chatId, '❌ Usage: /ban @username or reply to a message');
      return;
    }
    // Would need to lookup user ID from username (complex)
    await reply(chatId, '❌ Please reply to the user\'s message to ban them');
    return;
  }
  
  const result = await banUser(chatId, targetUserId);
  if (result.ok) {
    await reply(chatId, `🔨 Banned @${targetUsername}`);
  } else {
    await reply(chatId, `❌ Failed to ban user: ${result.description || 'Unknown error'}`);
  }
  return;
}

// /unban @user  
if (textLower.startsWith('/unban')) {
  if (!await isAdmin(userId)) {
    await reply(chatId, '❌ Admin access required');
    return;
  }
  
  const match = text.match(/\/unban\s+(\d+)/);
  if (!match) {
    await reply(chatId, '❌ Usage: /unban [user_id]');
    return;
  }
  
  const targetUserId = match[1];
  const result = await unbanUser(chatId, targetUserId);
  if (result.ok) {
    await reply(chatId, `✅ Unbanned user ${targetUserId}`);
  } else {
    await reply(chatId, `❌ Failed to unban: ${result.description || 'Unknown error'}`);
  }
  return;
}

// /mute @user [duration]
if (textLower.startsWith('/mute')) {
  if (!await isAdmin(userId)) {
    await reply(chatId, '❌ Admin access required');
    return;
  }
  
  let targetUserId = null;
  let targetUsername = 'user';
  let duration = 3600; // 1 hour default
  
  if (update.message.reply_to_message) {
    targetUserId = update.message.reply_to_message.from.id;
    targetUsername = update.message.reply_to_message.from.username || update.message.reply_to_message.from.first_name;
    // Check for duration in command
    const match = text.match(/(\d+)([hm]?)/);
    if (match) {
      const num = parseInt(match[1]);
      const unit = match[2] || 'm';
      duration = unit === 'h' ? num * 3600 : num * 60;
    }
  } else {
    await reply(chatId, '❌ Please reply to the user\'s message to mute them');
    return;
  }
  
  const result = await muteUser(chatId, targetUserId, duration);
  if (result.ok) {
    await reply(chatId, `🔇 Muted @${targetUsername} for ${Math.floor(duration/60)} minutes`);
  } else {
    await reply(chatId, `❌ Failed to mute user: ${result.description || 'Unknown error'}`);
  }
  return;
}

// /unmute @user
if (textLower.startsWith('/unmute')) {
  if (!await isAdmin(userId)) {
    await reply(chatId, '❌ Admin access required');
    return;
  }
  
  let targetUserId = null;
  let targetUsername = 'user';
  
  if (update.message.reply_to_message) {
    targetUserId = update.message.reply_to_message.from.id;
    targetUsername = update.message.reply_to_message.from.username || update.message.reply_to_message.from.first_name;
  } else {
    await reply(chatId, '❌ Please reply to the user\'s message to unmute them');
    return;
  }
  
  const result = await unmuteUser(chatId, targetUserId);
  if (result.ok) {
    await reply(chatId, `🔊 Unmuted @${targetUsername}`);
  } else {
    await reply(chatId, `❌ Failed to unmute user: ${result.description || 'Unknown error'}`);
  }
  return;
}
```

## Notes:
- Admin IDs are hardcoded for security
- Ban/mute work by replying to the target user's message  
- Mute duration: `/mute` (1h), `/mute 30m` (30 min), `/mute 2h` (2 hours)
- Only Connor-approved admins can use these commands
- Bot needs admin privileges in the TG group to ban/restrict users

## Integration:
Add these functions and commands to telegram-bot.cjs around line 1300+ where other commands are handled.