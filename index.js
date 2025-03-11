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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Register slash commands
    const commands = [
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

// Command handler for /assign
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'assign') {
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

        // Create timer control panel in the work timer channel
        let durationDisplay = minutes > 0 ? `${hours} hours and ${minutes} minutes` : `${hours} hours`;
        const timerPanel = new EmbedBuilder()
            .setTitle('🕒 Work Timer Control Panel')
            .setDescription(`**Timer assigned to:** ${freelancer.toString()}\n**Duration:** ${durationDisplay}`)
            .setColor('#4F6AFF') // A more vibrant blue color
            .addFields(
                { name: '⏱️ Timer Information', value: 'Use the buttons below to manage your work session.' }
            )
            .setTimestamp()
            .setFooter({ text: 'Click the buttons below to manage your work timer' });

        // Create buttons with improved styling
        const startButton = new ButtonBuilder()
            .setCustomId(`start_${freelancer.id}`)
            .setLabel('Start Work')
            .setStyle(ButtonStyle.Success)
            .setEmoji('⚡');

        const completeButton = new ButtonBuilder()
            .setCustomId(`complete_${freelancer.id}`)
            .setLabel('Complete Work')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✅');
            
        // Create separate rows for each button for vertical layout
        const startRow = new ActionRowBuilder().addComponents(startButton);
        const completeRow = new ActionRowBuilder().addComponents(completeButton);

        // Set channel permissions to prevent message sending but allow reactions
        await interaction.channel.permissionOverwrites.create(freelancer, {
            SendMessages: false,
            ViewChannel: true
        });

        await interaction.channel.send({
            embeds: [timerPanel],
            components: [startRow, completeRow] // Use separate rows for vertical layout
        });
    }
});

// Button and modal interaction handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, userId] = interaction.customId.split('_');
    console.log(`Button interaction: ${action} button clicked by user ${interaction.user.tag} (ID: ${interaction.user.id})`);
    
    if (action === 'start') {
        // Handle start button click
        if (interaction.user.id !== userId) {
            console.log(`Access denied: User ${interaction.user.tag} attempted to start timer assigned to user ID ${userId}`);
            return interaction.reply({ content: 'This timer is not assigned to you.', ephemeral: true });
        }

        console.log(`Timer started by freelancer ${interaction.user.tag} (ID: ${userId})`);
        await interaction.reply({ 
            content: '⚡ Timer started! Good luck with your work!', 
            ephemeral: true 
        });
    }
    else if (action === 'complete') {
        // Handle complete button click
        if (interaction.user.id !== userId) {
            console.log(`Access denied: User ${interaction.user.tag} attempted to complete timer assigned to user ID ${userId}`);
            return interaction.reply({ content: 'This timer is not assigned to you.', ephemeral: true });
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
                    .setThumbnail('https://i.imgur.com/6YToyEF.png') // Success icon or any relevant image
                    .setTimestamp()
                    .setFooter({ text: 'Work completed successfully' })
            ]
        });

        // Clear the timer
        activeTimers.delete(userId);
        console.log(`Timer removed for freelancer ${interaction.user.tag} (ID: ${userId})`);
        await interaction.reply({ content: 'Work marked as complete!', ephemeral: true });
    }
});

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
                
                // Calculate days since expiration
                const daysSinceExpiration = (now - timer.endTime) / (24 * 60 * 60 * 1000);
                
                // Create a more informative reminder message based on reminder count and timing
                let reminderMessage = `${user.toString()} Your deadline has expired! `;
                
                if (daysSinceExpiration < 1) {
                    // First day reminders
                    if (timer.reminderCount === 0) {
                        reminderMessage += "This is your first reminder. Please provide an update on your work status.";
                    } else {
                        reminderMessage += "This is your second reminder today. Please provide an update on your work status.";
                    }
                } else {
                    // Daily reminders after first day
                    reminderMessage += `This is your daily reminder (day ${Math.floor(daysSinceExpiration) + 1}). Please provide an update on your work status.`;
                }
                
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
    
    // Calculate days since expiration (when first reminder was sent)
    const daysSinceFirstReminder = timer.reminderCount > 0 ? 
        (Date.now() - (timer.endTime + 1)) / (24 * 60 * 60 * 1000) : 0;
    
    console.log(`Checking if reminder should be sent - Hours since last reminder: ${hoursSinceLastReminder.toFixed(2)}, Reminder count: ${timer.reminderCount}`);
    console.log(`Days since first reminder: ${daysSinceFirstReminder.toFixed(2)}`);
    
    if (timer.reminderCount === 0) {
        console.log('Sending first reminder immediately after expiration');
        return true; // First reminder immediately after expiration
    } else if (daysSinceFirstReminder < 1) {
        // First day: Send second reminder after 12 hours
        const shouldSend = hoursSinceLastReminder >= 12;
        console.log(`Checking for 12-hour reminder (first day) - Should send: ${shouldSend} (${hoursSinceLastReminder.toFixed(2)} hours elapsed, threshold: 12 hours)`);
        return shouldSend;
    } else {
        // After first day: Send one reminder per day
        const shouldSend = hoursSinceLastReminder >= 24;
        console.log(`Checking for daily reminder - Should send: ${shouldSend} (${hoursSinceLastReminder.toFixed(2)} hours elapsed, threshold: 24 hours)`);
        return shouldSend;
    }
}

// Use the bot token from environment variables
client.login(process.env.DISCORD_BOT_TOKEN);