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
        const privateChannel = interaction.options.getChannel('private_channel');

        // Store the freelancer's private channel
        freelancerChannels.set(freelancer.id, privateChannel.id);

        // Create timer data
        const timerData = {
            endTime: Date.now() + (hours * 60 * 60 * 1000),
            privateChannelId: privateChannel.id,
            reminderCount: 0,
            lastReminderTime: null
        };

        activeTimers.set(freelancer.id, timerData);

        // Send confirmation message
        await interaction.reply({
            content: `Timer assigned to ${freelancer.toString()} for ${hours} hours. Private channel: ${privateChannel.toString()}`,
            ephemeral: true
        });

        // Create timer control panel in the work timer channel
        const timerPanel = new EmbedBuilder()
            .setTitle('🕒 Work Timer Control Panel')
            .setDescription(`Timer assigned to ${freelancer.toString()}\nDuration: ${hours} hours`)
            .setColor('#2F3136')
            .setFooter({ text: 'Click the buttons below to manage your work timer' });

        const startButton = new ButtonBuilder()
            .setCustomId(`start_${freelancer.id}`)
            .setLabel('Start Work')
            .setStyle(ButtonStyle.Success)
            .setEmoji('⚡');

        const completeButton = new ButtonBuilder()
            .setCustomId(`complete_${freelancer.id}`)
            .setLabel('Complete Work')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✨');

        const row = new ActionRowBuilder().addComponents(startButton, completeButton);

        // Set channel permissions to prevent message sending but allow reactions
        await interaction.channel.permissionOverwrites.create(freelancer, {
            SendMessages: false,
            ViewChannel: true
        });

        await interaction.channel.send({
            embeds: [timerPanel],
            components: [row]
        });
    }
});

// Button and modal interaction handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, userId] = interaction.customId.split('_');
    
    if (action === 'start') {
        // Handle start button click
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: 'This timer is not assigned to you.', ephemeral: true });
        }

        await interaction.reply({ content: 'Timer started! Good luck with your work!', ephemeral: true });
    }
    else if (action === 'complete') {
        // Handle complete button click
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: 'This timer is not assigned to you.', ephemeral: true });
        }

        const privateChannelId = freelancerChannels.get(userId);
        if (!privateChannelId) return;

        const privateChannel = await client.channels.fetch(privateChannelId);
        
        // Send work completion message
        await privateChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Work Completed')
                    .setDescription('Work has been marked as complete. Please remember to:\n\n1. Attach your completed work in this chat\n2. Upload the work to Trello\n3. Move the Trello card to the appropriate list')
                    .setColor('#00FF00')
                    .setTimestamp()
            ]
        });

        // Clear the timer
        activeTimers.delete(userId);
        await interaction.reply({ content: 'Work marked as complete!', ephemeral: true });
    }
});

// Reminder system
setInterval(async () => {
    const now = Date.now();

    for (const [userId, timer] of activeTimers.entries()) {
        if (now >= timer.endTime && (!timer.lastReminderTime || shouldSendReminder(timer))) {
            const privateChannel = await client.channels.fetch(timer.privateChannelId);
            const user = await client.users.fetch(userId);

            await privateChannel.send(`${user.toString()} Your deadline has expired! Please provide an update on your work status.`);

            // Update reminder data
            timer.reminderCount++;
            timer.lastReminderTime = now;
        }
    }
}, 60000); // Check every minute

// Helper function to determine if a reminder should be sent
function shouldSendReminder(timer) {
    const hoursSinceLastReminder = (Date.now() - timer.lastReminderTime) / (60 * 60 * 1000);
    
    if (timer.reminderCount === 0) {
        return true; // First reminder
    } else if (timer.reminderCount <= 2) {
        return hoursSinceLastReminder >= 12; // Two reminders per day (every 12 hours)
    } else {
        return hoursSinceLastReminder >= 24; // One reminder per day
    }
}

// Use the bot token from environment variables
client.login(process.env.DISCORD_BOT_TOKEN);