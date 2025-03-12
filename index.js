// Load environment variables
require('dotenv').config();

const { Client, GatewayIntentBits, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// Store active timers and their associated data
const activeTimers = new Map();

// Store freelancer channel mappings
const freelancerChannels = new Map();

// Store user timer settings (persisted durations)
const userTimerSettings = new Map();

// Store main panel message ID and channel ID
let mainPanelMessageId = null;
let mainPanelChannelId = null;

// Store interval for updating countdown timers
let countdownInterval = null;

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Register slash commands
    const commands = [
        {
            name: 'panel',
            description: 'Create a work timer panel in the current channel',
            options: [
                {
                    name: 'channel',
                    description: 'The channel to create the panel in (defaults to current channel)',
                    type: 7, // CHANNEL type
                    required: false
                }
            ]
        },
        {
            name: 'assign',
            description: 'Assign a timer to a freelancer and link their private channel',
            options: [
                {
                    name: 'freelancer',
                    description: 'The freelancer to assign the timer to',
                    type: 6, // USER type
                    required: true
                },
                {
                    name: 'time_in_hours',
                    description: 'Duration of the timer in hours',
                    type: 10, // NUMBER type
                    required: true
                },
                {
                    name: 'private_channel',
                    description: 'The private channel for the freelancer',
                    type: 7, // CHANNEL type
                    required: true
                },
                {
                    name: 'time_in_minutes',
                    description: 'Additional minutes for the timer',
                    type: 10, // NUMBER type
                    required: false
                }
            ]
        }
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

// Command handler for slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'panel') {
        // Check if user has admin permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need administrator permissions to use this command.', ephemeral: true });
        }

        // Get the channel to create the panel in (default to current channel)
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        
        // Create the main panel embed
        const mainPanel = new EmbedBuilder()
            .setTitle('🕒 Work Timer Control Panel')
            .setDescription('**Welcome to the Work Timer System**\n\nThis panel allows freelancers to manage their assigned work timers.')
            .setColor('#4F6AFF')
            .addFields(
                { name: '⏱️ Timer Information', value: 'No active timers currently. Admins must assign timers to freelancers using the `/assign` command.' },
                { name: '📋 Instructions', value: '1. Admins assign timers using `/assign`\n2. Assigned freelancers can use the buttons below\n3. Countdown timers will appear here when assigned' }
            )
            .setTimestamp()
            .setFooter({ text: 'Work Timer System' });

        // Create buttons (disabled by default until assigned)
        const startButton = new ButtonBuilder()
            .setCustomId('start_unassigned')
            .setLabel('Start Work')
            .setStyle(ButtonStyle.Success)
            .setEmoji('⚡')
            .setDisabled(true);

        const completeButton = new ButtonBuilder()
            .setCustomId('complete_unassigned')
            .setLabel('Complete Work')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✅')
            .setDisabled(true);
            
        // Create separate rows for each button for vertical layout
        const startRow = new ActionRowBuilder().addComponents(startButton);
        const completeRow = new ActionRowBuilder().addComponents(completeButton);

        // Set channel permissions to prevent message sending for everyone except the bot
        await channel.permissionOverwrites.create(interaction.guild.roles.everyone, {
            SendMessages: false,
            ViewChannel: true
        });
        
        // Allow the bot to send messages
        await channel.permissionOverwrites.create(client.user.id, {
            SendMessages: true,
            ViewChannel: true
        });

        // Send the panel and store its message ID and channel ID
        const panelMessage = await channel.send({
            embeds: [mainPanel],
            components: [startRow, completeRow]
        });
        
        mainPanelMessageId = panelMessage.id;
        mainPanelChannelId = channel.id;
        
        // Start the countdown interval if not already running
        if (!countdownInterval) {
            countdownInterval = setInterval(updateCountdowns, 10000); // Update every 10 seconds
        }

        await interaction.reply({ content: `Work Timer Panel created in ${channel.toString()}!`, ephemeral: true });
    }
    else if (interaction.commandName === 'assign') {
        // Check if user has admin permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need administrator permissions to use this command.', ephemeral: true });
        }

        const freelancer = interaction.options.getUser('freelancer');
        const hours = interaction.options.getNumber('time_in_hours');
        const minutes = interaction.options.getNumber('time_in_minutes') || 0;
        const privateChannel = interaction.options.getChannel('private_channel');

        // Store the freelancer's private channel
        freelancerChannels.set(freelancer.id, privateChannel.id);

        // Store the user's timer settings for future use
        userTimerSettings.set(freelancer.id, {
            hours: hours,
            minutes: minutes,
            totalDurationHours: hours + (minutes / 60)
        });
        
        // Create timer data
        const timerData = {
            endTime: Date.now() + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000),
            privateChannelId: privateChannel.id,
            reminderCount: 0,
            lastReminderTime: null,
            totalDurationHours: hours + (minutes / 60) // Store the original duration in hours
        };

        activeTimers.set(freelancer.id, timerData);

        // Send confirmation message
        let durationText = minutes > 0 ? `${hours} hours and ${minutes} minutes` : `${hours} hours`;
        await interaction.reply({
            content: `Timer assigned to ${freelancer.toString()} for ${durationText}. Private channel: ${privateChannel.toString()}`,
            ephemeral: true
        });

        // Update the main panel if it exists
        if (mainPanelMessageId && mainPanelChannelId) {
            try {
                const mainChannel = await client.channels.fetch(mainPanelChannelId);
                const mainMessage = await mainChannel.messages.fetch(mainPanelMessageId);
                
                // Update the panel with the new assignment
                await updateMainPanel();
                
                // Set permissions for the freelancer in the main channel
                await mainChannel.permissionOverwrites.create(freelancer, {
                    SendMessages: false,
                    ViewChannel: true
                });
            } catch (error) {
                console.error('Error updating main panel:', error);
            }
        } else {
            await interaction.followUp({ 
                content: 'No main panel found. Please create one using the `/panel` command first.', 
                ephemeral: true 
            });
        }
    }
});

// Button and modal interaction handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, buttonType] = interaction.customId.split('_');
    console.log(`Button interaction: ${action} button clicked by user ${interaction.user.tag} (ID: ${interaction.user.id})`);
    
    // Handle unassigned buttons
    if (buttonType === 'unassigned') {
        return interaction.reply({ 
            content: 'You have not been assigned a timer yet. Please ask an administrator to assign you a timer.', 
            ephemeral: true 
        });
    }
    
    // Check if the user has an assigned timer or settings before proceeding
    const userId = interaction.user.id;
    const hasActiveTimer = activeTimers.has(userId);
    const hasTimerSettings = userTimerSettings.has(userId);
    
    if (!hasActiveTimer && !hasTimerSettings) {
        return interaction.reply({ 
            content: 'You have not been assigned a timer yet. Please ask an administrator to assign you a timer.', 
            ephemeral: true 
        });
    }
    
    // Ensure all buttons work with both 'any' and user-specific IDs
    // This ensures compatibility with the main panel buttons
    
    if (action === 'start') {
        // Handle start button click
        const userId = interaction.user.id;
        
        // Check if user has an active timer or stored settings
        let timerData = activeTimers.get(userId);
        const userSettings = userTimerSettings.get(userId);
        
        if (!timerData && !userSettings) {
            return interaction.reply({ content: 'No timer found for you. Please ask an administrator to assign you a timer.', ephemeral: true });
        }
        
        // If timer is completed but user has settings, create a new timer with the stored duration
        if (!timerData && userSettings) {
            const privateChannelId = freelancerChannels.get(userId);
            if (!privateChannelId) {
                return interaction.reply({ content: 'No private channel found for you. Please ask an administrator to reassign your timer.', ephemeral: true });
            }
            
            // Create a new timer with the stored settings
            timerData = {
                endTime: Date.now() + (userSettings.hours * 60 * 60 * 1000) + (userSettings.minutes * 60 * 1000),
                privateChannelId: privateChannelId,
                reminderCount: 0,
                lastReminderTime: null,
                totalDurationHours: userSettings.totalDurationHours
            };
            
            // Store the new timer
            activeTimers.set(userId, timerData);
        }

        console.log(`Timer started by freelancer ${interaction.user.tag} (ID: ${userId})`);
        
        // Send a message to the private channel
        try {
            const privateChannel = await client.channels.fetch(timerData.privateChannelId);
            const timeLeft = formatTimeLeft(timerData.endTime - Date.now());
            
            await privateChannel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⚡ Work Timer Started')
                        .setDescription(`You have started your work timer!`)
                        .addFields(
                            { name: '⏱️ Time Remaining', value: timeLeft },
                            { name: '📋 Instructions', value: 'Complete your work within the allocated time and click the "Complete Work" button when finished.' }
                        )
                        .setColor('#43B581')
                        .setTimestamp()
                        .setFooter({ text: 'Work timer started' })
                ]
            });
        } catch (error) {
            console.error(`Error sending start message to private channel:`, error);
        }
        
        await interaction.reply({ 
            content: '⚡ Timer started! Good luck with your work! Check your private channel for details.', 
            ephemeral: true
        });
        
        // Update the main panel
        await updateMainPanel();
    }
    else if (action === 'complete') {
        // Handle complete button click
        const userId = interaction.user.id;
        
        // Check if the user has an active timer
        if (!activeTimers.has(userId)) {
            console.log(`Access denied: User ${interaction.user.tag} attempted to complete timer but has no active timer`);
            return interaction.reply({ content: 'You do not have an active timer assigned to you.', ephemeral: true });
        }

        const privateChannelId = freelancerChannels.get(userId);
        if (!privateChannelId) {
            console.log(`Error: No private channel found for user ID ${userId}`);
            return;
        }

        const privateChannel = await client.channels.fetch(privateChannelId);
        console.log(`Work completed by freelancer ${interaction.user.tag} (ID: ${userId})`);
        
        // Send work completion message with improved design
        await privateChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Work Completed')
                    .setDescription('**Congratulations!** Your work has been marked as complete.')
                    .addFields(
                        { name: '📋 Next Steps', value: '1️⃣ Attach your completed work in this chat\n2️⃣ Upload the work to Trello\n3️⃣ Move the Trello card to the appropriate list' },
                        { name: '🎉 Great Job!', value: 'Thank you for completing your work on time.' }
                    )
                    .setColor('#43B581') // Discord green color
                    .setThumbnail('https://www.highschoolillustrated.com/wp-content/uploads/2013/01/success_sign.png') // Updated success checkmark icon
                    .setTimestamp()
                    .setFooter({ text: 'Work completed successfully' })
            ]
        });

        // Clear the timer
        activeTimers.delete(userId);
        console.log(`Timer removed for freelancer ${interaction.user.tag} (ID: ${userId})`);
        await interaction.reply({ content: 'Work marked as complete!', ephemeral: true });
        
        // Update the main panel
        await updateMainPanel();
    }
});
// Helper function to update the main panel with current timer information
async function updateMainPanel() {
    if (!mainPanelMessageId || !mainPanelChannelId) return;
    
    try {
        const mainChannel = await client.channels.fetch(mainPanelChannelId);
        const mainMessage = await mainChannel.messages.fetch(mainPanelMessageId);
        
        // Create the updated panel embed
        const updatedPanel = new EmbedBuilder()
            .setTitle('🕒 Work Timer Control Panel')
            .setDescription('**Welcome to the Work Timer System**\n\nThis panel allows freelancers to manage their assigned work timers.')
            .setColor('#4F6AFF')
            .setTimestamp()
            .setFooter({ text: 'Work Timer System' });
        
        // Add active timer information
        if (activeTimers.size > 0) {
            const timerFields = [];
            
            for (const [userId, timer] of activeTimers.entries()) {
                try {
                    const user = await client.users.fetch(userId);
                    const timeLeft = formatTimeLeft(timer.endTime - Date.now());
                    
                    timerFields.push({
                        name: `${user.username}'s Timer`,
                        value: `⏱️ **Time Remaining:** ${timeLeft}\n📅 **Total Duration:** ${formatDuration(timer.totalDurationHours)}`
                    });
                } catch (error) {
                    console.error(`Error fetching user ${userId}:`, error);
                }
            }
            
            updatedPanel.addFields(timerFields);
        } else {
            updatedPanel.addFields({
                name: '⏱️ Timer Information',
                value: 'No active timers currently. Admins must assign timers to freelancers using the `/assign` command.'
            });
        }
        
        updatedPanel.addFields({
            name: '📋 Instructions',
            value: '1. Admins assign timers using `/assign`\n2. Assigned freelancers can use the buttons below\n3. Countdown timers will appear here when assigned'
        });
        
        // Create stable buttons that work for all users
        const components = [];
        
        // Always create just two buttons regardless of how many users have timers
        if (activeTimers.size > 0) {
            // Create enabled buttons when timers are assigned
            const startButton = new ButtonBuilder()
                .setCustomId('start_any')
                .setLabel('Start Work')
                .setStyle(ButtonStyle.Success)
                .setEmoji('⚡');

            const completeButton = new ButtonBuilder()
                .setCustomId('complete_any')
                .setLabel('Complete Work')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅');
                
            // Create separate rows for each button for vertical layout
            const startRow = new ActionRowBuilder().addComponents(startButton);
            const completeRow = new ActionRowBuilder().addComponents(completeButton);
            
            components.push(startRow, completeRow);
        } else {
            // Create disabled buttons when no timers are assigned
            const startButton = new ButtonBuilder()
                .setCustomId('start_unassigned')
                .setLabel('Start Work')
                .setStyle(ButtonStyle.Success)
                .setEmoji('⚡')
                .setDisabled(true);

            const completeButton = new ButtonBuilder()
                .setCustomId('complete_unassigned')
                .setLabel('Complete Work')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅')
                .setDisabled(true);
                
            // Create separate rows for each button for vertical layout
            const startRow = new ActionRowBuilder().addComponents(startButton);
            const completeRow = new ActionRowBuilder().addComponents(completeButton);
            
            components.push(startRow, completeRow);
        }
        
        // Update the main panel message
        await mainMessage.edit({
            embeds: [updatedPanel],
            components: components
        });
    } catch (error) {
        console.error('Error updating main panel:', error);
    }
}

// Helper function to format time left for display
function formatTimeLeft(milliseconds) {
    if (milliseconds <= 0) {
        return '⏰ **EXPIRED**';
    }
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    
    let timeString = '';
    
    if (days > 0) {
        timeString += `${days}d `;
    }
    
    timeString += `${remainingHours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    
    return timeString;
}

// Helper function to format duration in hours
function formatDuration(hours) {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    
    if (minutes > 0) {
        return `${wholeHours} hours and ${minutes} minutes`;
    } else {
        return `${wholeHours} hours`;
    }
}

// Function to update all countdowns in the main panel
function updateCountdowns() {
    updateMainPanel();
}
// Reminder system
setInterval(async () => {
    const now = Date.now();
    console.log(`Checking reminders at ${new Date(now).toISOString()} - Active timers: ${activeTimers.size}`);

    for (const [userId, timer] of activeTimers.entries()) {
        console.log(`Checking timer for user ID ${userId} - End time: ${new Date(timer.endTime).toISOString()}, Reminder count: ${timer.reminderCount}`);
        
        if (now >= timer.endTime && (!timer.lastReminderTime || shouldSendReminder(timer))) {
            try {
                const privateChannel = await client.channels.fetch(timer.privateChannelId);
                const user = await client.users.fetch(userId);
                
                console.log(`Sending reminder #${timer.reminderCount + 1} to ${user.tag} (ID: ${userId})`);
                
                // Calculate hours since expiration
                const hoursSinceExpiration = (now - timer.endTime) / (60 * 60 * 1000);
                
                // Get the appropriate reminder message based on time elapsed
                const reminderMessage = getEscalatingReminderMessage(user, hoursSinceExpiration, timer.reminderCount);
                
                await privateChannel.send(reminderMessage);

                // Update reminder data
                timer.reminderCount++;
                timer.lastReminderTime = now;
                console.log(`Reminder sent successfully. New reminder count: ${timer.reminderCount}`);
            } catch (error) {
                console.error(`Error sending reminder to user ID ${userId}:`, error);
            }
        }
    }
}, 60000); // Check every minute

// Helper function to determine if a reminder should be sent
function shouldSendReminder(timer) {
    const hoursSinceLastReminder = (Date.now() - timer.lastReminderTime) / (60 * 60 * 1000);
    
    // Calculate hours since expiration
    const hoursSinceExpiration = (Date.now() - timer.endTime) / (60 * 60 * 1000);
    
    console.log(`Checking if reminder should be sent - Hours since last reminder: ${hoursSinceLastReminder.toFixed(2)}, Hours since expiration: ${hoursSinceExpiration.toFixed(2)}, Reminder count: ${timer.reminderCount}`);
    
    if (timer.reminderCount === 0) {
        console.log('Sending first reminder immediately after expiration');
        return true; // First reminder immediately after expiration
    } else if (hoursSinceExpiration < 12) {
        // No additional reminders needed in the first 12 hours
        return false;
    } else if (hoursSinceExpiration >= 12 && hoursSinceExpiration < 24 && timer.reminderCount === 1) {
        // Second reminder at 12 hours
        return true;
    } else if (hoursSinceExpiration >= 24 && hoursSinceExpiration < 48 && timer.reminderCount === 2) {
        // Third reminder at 24 hours
        return true;
    } else if (hoursSinceExpiration >= 48 && hoursSinceExpiration < 72 && timer.reminderCount === 3) {
        // Fourth reminder at 48 hours
        return true;
    } else if (hoursSinceExpiration >= 72 && hoursSinceExpiration < 96 && timer.reminderCount === 4) {
        // Fifth reminder at 72 hours
        return true;
    } else if (hoursSinceExpiration >= 96 && timer.reminderCount === 5) {
        // Final reminder at 96 hours
        return true;
    }
    
    return false;
}

// Function to get escalating reminder messages based on time elapsed
function getEscalatingReminderMessage(user, hoursSinceExpiration, reminderCount) {
    // Immediate follow-up (right when the deadline passes)
    if (reminderCount === 0) {
        return `${user.toString()} ⏳ Your deadline has passed. We have not received your submission or an update. If there is a delay, you need to make us aware of the reason and provide a specific updated timeline for delivery.`;
    }
    // First reminder (12 hours after the deadline)
    else if (hoursSinceExpiration >= 12 && hoursSinceExpiration < 24) {
        return `${user.toString()} 🚨 12 hours overdue. We still haven't received your submission or an update. This must be addressed immediately. Let us know your status and when we can expect delivery.`;
    }
    // Second reminder (24 hours after the deadline)
    else if (hoursSinceExpiration >= 24 && hoursSinceExpiration < 48) {
        return `${user.toString()} ⚠️ 24 hours overdue. This delay is now affecting the project timeline, which is not acceptable. We need an immediate update with a firm delivery time.`;
    }
    // Third reminder (48 hours after the deadline)
    else if (hoursSinceExpiration >= 48 && hoursSinceExpiration < 72) {
        return `${user.toString()} ⏳ 48 hours overdue. This extended delay is causing significant issues. We need to know exactly when this will be delivered. A lack of communication will force us to take further action.`;
    }
    // Fourth reminder (72 hours after the deadline)
    else if (hoursSinceExpiration >= 72 && hoursSinceExpiration < 96) {
        return `${user.toString()} 🚨 72 hours overdue. This is the second-last reminder. If we do not receive a response in the next 24 hours, we will begin looking for another candidate to complete this task. Please respond with an immediate update.`;
    }
    // Final reminder (96 hours after the deadline)
    else {
        return `${user.toString()} ❗ Final Decision: 4 days overdue. Since we have not received an update, we will be moving forward with another candidate to complete this task. If you wish to discuss this further, reach out immediately, but we can no longer wait.`;
    }
}

// Use the bot token from environment variables
client.login(process.env.DISCORD_BOT_TOKEN);