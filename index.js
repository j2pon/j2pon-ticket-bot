import 'dotenv/config';
import { MongoClient } from 'mongodb';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
} from 'discord.js';

const MONGODB_URI = process.env.MONGODB_URI || '';
let mongoDb = null;
async function getDb() {
  if (!MONGODB_URI) return null;
  if (mongoDb) return mongoDb;
  const client = new MongoClient(MONGODB_URI);
  await client.connect().catch(() => null);
  mongoDb = client.db();
  return mongoDb;
}

async function ticketInsert(guildId, channelId, openerId, categorySlug, categoryName, ticketNum) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db.collection('tickets').insertOne({
    guildId,
    channelId,
    openerId,
    categorySlug,
    categoryName,
    ticketNum,
    status: 'open',
    claimedBy: null,
    createdAt: now,
    createdAtUnix: Math.floor(now.getTime() / 1000),
    closedAt: null,
  });
}

async function ticketUpdateStatus(channelId, status, claimedBy = null) {
  const db = await getDb();
  if (!db) return;
  await db.collection('tickets').updateOne(
    { channelId },
    { $set: { status, ...(claimedBy != null && { claimedBy }) } }
  );
}

async function ticketClose(channelId) {
  const db = await getDb();
  if (!db) return;
  await db.collection('tickets').updateOne(
    { channelId },
    { $set: { closedAt: new Date(), status: 'closed' } }
  );
}

async function ticketEvent(guildId, channelId, userId, action, actorId = null) {
  const db = await getDb();
  if (!db) return;
  await db.collection('ticket_events').insertOne({
    guildId,
    channelId,
    userId,
    action,
    actorId,
    createdAt: new Date(),
  });
}

async function ticketFindByChannel(channelId) {
  const db = await getDb();
  if (!db) return null;
  return db.collection('tickets').findOne({ channelId });
}

/** Kategoride DB'ye işlenmiş ticket sayısına göre sonraki numara (1, 2, 3...). */
async function getNextTicketNumberFromDb(guildId, categorySlug) {
  const db = await getDb();
  if (!db) return 1;
  const count = await db.collection('tickets').countDocuments({ guildId, categorySlug });
  return count + 1;
}

async function ticketTopOpeners(guildId, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.collection('tickets').aggregate([
    { $match: { guildId } },
    { $group: { _id: '$openerId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]).toArray();
}

async function ticketTopStaff(guildId, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.collection('tickets').aggregate([
    { $match: { guildId, claimedBy: { $ne: null } } },
    { $group: { _id: '$claimedBy', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]).toArray();
}

async function ticketUserStats(guildId, userId) {
  const db = await getDb();
  if (!db) return { opened: 0, handled: 0 };
  const opened = await db.collection('tickets').countDocuments({ guildId, openerId: userId });
  const handled = await db.collection('tickets').countDocuments({ guildId, claimedBy: userId });
  return { opened, handled };
}

// Sayfa başına öğe sayısı (videodaki "listagem" gibi)
const LIST_ITEMS_PER_PAGE = 5;
const LIST_ITEMS = [
  'Oyun İçi Destek',
  'Teknik Destek',
  'Şikayet & Öneri',
  'Reklam Başvurusu',
  'Yetkili Başvurusu',
  'Partnerlik',
  'Diğer',
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ========== Dashboard tipi ticket ==========
const TICKET_CONFIG = {
  authorName: 'J2pon',
  footerText: "J2pon",
  defaultImageUrl: 'https://cdn.discordapp.com/attachments/1459928953081958696/1470603596407111751/0fb7d698-138a-4c9a-96f5-f43300c15ee3.png?ex=698be5d3&is=698a9453&hm=89d9ba8b2001a057ac8dd9a036ffb7415b10ca5bd4f0a51f64bd69628b3e15cf&', // Mor 'W' logosu / Duvar_Kagd: URL buraya
  roleId: '', // Yetkili rol ID (mention için, örn. '1223201961319338065')
};

// ========== /ticket-kur panel + kategoriye göre ticket açma ==========
/** Custom emoji: { id: 'snowflake', name: 'emoji_adi' } */
const TICKET_SETUP = {
  footerText: "J2pon",
  panelImageUrl: 'https://cdn.discordapp.com/attachments/1459928953081958696/1470603596407111751/0fb7d698-138a-4c9a-96f5-f43300c15ee3.png?ex=698be5d3&is=698a9453&hm=89d9ba8b2001a057ac8dd9a036ffb7415b10ca5bd4f0a51f64bd69628b3e15cf&',
  thumbnailUrl: '', // Panel sağ üst thumbnail (mor/glitch görsel) – boş bırakılabilir
  titleEmoji: { id: '1453815780385882276', name: 'bildirim' }, // Başlıktaki bulut/konuşma emojisi
  categories: {
    oyunici: { name: 'Oyun İçi Destek', categoryId: '1470595517796061357', emoji: { id: '1453881092699324457', name: 'Transcript' } },
    teknik: { name: 'Teknik Destek', categoryId: '1470595532455153852', emoji: { id: '1453882159315161150', name: 'info_sari' } },
    donate: { name: 'Donate Bilgi', categoryId: '1470595546409340928', emoji: { id: '1453882012275314852', name: 'info_yesil' } },
    anticheat: { name: 'Anticheat', categoryId: '1470595563769696440', emoji: { id: '928282667273826355', name: 'cop' } },
  },
  supportRoleId: '', // Ticket kanallarına otomatik erişim verilecek yetkili rol
};

/**
 * /ticket-kur paneli – Components V2 (Container, TextDisplay, Separator, MediaGallery).
 * Section kullanılmıyor; accessory hatası ve custom emoji sorunları önlenir.
 */
function buildTicketKurPanel() {
  const titleContent = '## **Destek Talebi Oluştur**';
  const descContent = '> Bilet oluşturmadan önce aşağıdaki kuralları okuyunuz. Aşağıdaki butonlardan size uygun kategoriyi seçerek destek talebi oluşturabilirsiniz.';

  const rulesContent = [
    '**Genel Kurallar:**',
    '• Biletinizi **24 saat** içerisinde kontrol etmek zorundasınız.',
    '• Yönetim üyelerine özel mesaj atmaktan kaçının.',
    '• Sorunlarınızı bilet aracılığıyla iletişim kurun.',
    '',
    '**Sorun Bildirimi:**',
    '• Sorunu detaylı bir şekilde açıklayın.',
    '• Gerekli bilgileri eksiksiz paylaşın.',
  ].join('\n');

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(titleContent),
      new TextDisplayBuilder().setContent(descContent),
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(rulesContent));

  if (TICKET_SETUP.panelImageUrl) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder({ media: { url: TICKET_SETUP.panelImageUrl } })),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(TICKET_SETUP.footerText),
  );

  const c = TICKET_SETUP.categories;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create_oyunici')
      .setLabel('Oyun İçi Destek')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(c.oyunici.emoji?.id && c.oyunici.emoji?.name ? { id: c.oyunici.emoji.id, name: c.oyunici.emoji.name } : '🎮'),
    new ButtonBuilder()
      .setCustomId('ticket_create_teknik')
      .setLabel('Teknik Destek')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(c.teknik.emoji?.id && c.teknik.emoji?.name ? { id: c.teknik.emoji.id, name: c.teknik.emoji.name } : '🔧'),
    new ButtonBuilder()
      .setCustomId('ticket_create_donate')
      .setLabel('Donate Bilgi')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(c.donate.emoji?.id && c.donate.emoji?.name ? { id: c.donate.emoji.id, name: c.donate.emoji.name } : '💳')
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create_anticheat')
      .setLabel('Anticheat')
      .setStyle(ButtonStyle.Danger)
      .setEmoji(c.anticheat.emoji?.id && c.anticheat.emoji?.name ? { id: c.anticheat.emoji.id, name: c.anticheat.emoji.name } : '🛡️')
  );

  return { components: [container, row1, row2], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Kullanıcının bu kategoride açık ticket kanalı var mı kontrol eder.
 */
async function userHasOpenTicketInCategory(guild, userId, categoryId, categorySlug) {
  const category = guild.channels.cache.get(categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return false;
  let member = guild.members.cache.get(userId);
  if (!member) member = await guild.members.fetch(userId).catch(() => null);
  const userSlug = (member?.user?.username || String(userId)).toLowerCase().replace(/\s/g, '-').slice(0, 20);
  const prefix = `${userSlug}-${categorySlug}-`;
  const channels = guild.channels.cache.filter(
    (ch) => ch.parentId === categoryId && ch.type === ChannelType.GuildText && ch.name.startsWith(prefix)
  );
  for (const [, ch] of channels) {
    const overwrites = ch.permissionOverwrites.cache.get(userId);
    if (overwrites?.allow?.has(PermissionFlagsBits.ViewChannel)) return true;
  }
  return false;
}

/**
 * Ticket kanalı açar: isim username-kategorislug-num, kullanıcı + yetkili rol erişimi.
 * Ticket ID = kategoride DB'ye işlenen ticket sayısına göre (her açılan ticket DB'ye yazılır).
 */
async function createTicketChannel(interaction, categorySlug) {
  const guild = interaction.guild;
  const member = interaction.member;
  const userId = member.user.id;
  const cfg = TICKET_SETUP.categories[categorySlug];
  if (!cfg?.categoryId) {
    await interaction.reply({
      content: 'Bu kategori henüz yapılandırılmamış. (TICKET_SETUP.categories.' + categorySlug + '.categoryId)',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const hasOpen = await userHasOpenTicketInCategory(guild, userId, cfg.categoryId, categorySlug);
  if (hasOpen) {
    await interaction.reply({
      content: 'Bu kategoride zaten açık bir destek talebiniz var. Lütfen mevcut talebi kapatın veya o kanalı kullanın.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  const num = await getNextTicketNumberFromDb(guild.id, categorySlug);
  const usernameSlug = member.user.username.toLowerCase().replace(/\s/g, '-').slice(0, 20);
  const channelName = `${usernameSlug}-${categorySlug}-${num}`.slice(0, 100);

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  try {
    const channel = await guild.channels.create({
      name: channelName,
      parent: cfg.categoryId,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, type: 0, deny: PermissionFlagsBits.ViewChannel },
        { id: userId, type: 1, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks },
        ...(TICKET_SETUP.supportRoleId
          ? [{ id: TICKET_SETUP.supportRoleId, type: 0, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ManageMessages }]
          : []),
      ],
    });

    const createdAtUnix = Math.floor(Date.now() / 1000);
    const ticketPayload = {
      ticketId: String(num),
      userId: member.user.id,
      roleId: TICKET_CONFIG.roleId,
      category: cfg.name,
      status: 'open',
      createdAt: createdAtUnix,
      thumbnailURL: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
      bannerImageURL: TICKET_CONFIG.defaultImageUrl,
    };
    await ticketInsert(guild.id, channel.id, member.user.id, categorySlug, cfg.name, num);

    const components = buildTicketComponentsV2(ticketPayload);
    await channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
    }).catch(async (err) => {
      console.error('Ticket CV2 hatası, embed ile gönderiliyor:', err?.message);
      const embed = buildTicketDashboardEmbed({
        ticketId: String(num),
        createdBy: member.toString(),
        createdAt: new Date(createdAtUnix * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        supportRole: '**Yetkili Ekibi** rolün sahip yetkililer sizinle ilgilenecek.',
        category: cfg.name,
        avgResponse: '1 dakika - 8 dakika',
        ticketStatus: 'open',
        authorIconURL: client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }),
        thumbnailURL: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        embedImage: TICKET_CONFIG.defaultImageUrl,
      });
      await channel.send({ embeds: [embed], components: buildTicketDashboardButtons(null) }).catch(console.error);
    });

    await interaction.editReply({
      content: `Destek talebiniz oluşturuldu: ${channel}`,
    }).catch(() => {});
  } catch (err) {
    console.error('Ticket kanalı oluşturulamadı:', err);
    await interaction.editReply({
      content: 'Kanal oluşturulurken bir hata oluştu. Yetkililerle iletişime geçin.',
    }).catch(() => {});
  }
}

const TICKET_STATUS_MAP = {
  open: { text: 'ℹ️  Yetkili bekleniyor...', active: null },
  claimed: { text: (claimedId) => `<@${claimedId}> yetkilisi devraldı`, active: 'claim' },
  pending: { text: '⏳ Beklemede', active: 'pending' },
  review: { text: '🔍 İnceleniyor', active: 'review' },
  resolved: { text: '✅ Çözüldü', active: 'resolved' },
};

/**
 * JSON yapısına uygun Components V2 ticket mesajı (butonlar container içinde).
 * options.status: 'open'|'claimed'|'pending'|'review'|'resolved', options.claimedBy: userId (claim için)
 */
function buildTicketComponentsV2(options = {}) {
  const ticketId = options.ticketId ?? '2968';
  const userId = options.userId ?? '';
  const roleId = options.roleId ?? '';
  const category = options.category ?? 'Oyun İçi Destek';
  const avgResponse = options.avgResponse ?? '1 dakika - 8 dakika';
  const status = options.status ?? 'open';
  const claimedBy = options.claimedBy ?? null;
  const thumbnailURL = options.thumbnailURL ?? '';
  const bannerImageURL = options.bannerImageURL ?? TICKET_CONFIG.defaultImageUrl;
  const createdAt = options.createdAt ?? Math.floor(Date.now() / 1000);

  const statusInfo = TICKET_STATUS_MAP[status] || TICKET_STATUS_MAP.open;
  const statusText = typeof statusInfo.text === 'function' ? statusInfo.text(claimedBy) : statusInfo.text;
  const activeKey = statusInfo.active;

  const titleContent = `## ✅  Destek Talebi #${ticketId}`;
  const roleMention = roleId ? `**<@&${roleId}>**` : '**Yetkili Ekibi**';
  const descriptionContent = `> <@${userId}> tarafından ticket talebi **<t:${createdAt}:f>** tarihinde oluşturuldu. ${roleMention} rolün sahip yetkililer sizinle ilgilenecek.`;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(titleContent),
      new TextDisplayBuilder().setContent(descriptionContent),
    );
  if (thumbnailURL) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailURL));

  const bulletContent = [
    `- Destek ID:  **#${ticketId}**`,
    `- Destek Kategorisi:  **${category}**`,
    '',
    `- Ortalama Yanıt Süresi:  **${avgResponse}**`,
    `- Destek Durumu:  **${statusText}**`,
  ].join('\n');

  const statusButtons = [
    { key: 'claim', id: 'ticket-claim_ingame', label: 'Ticket Claim', emoji: 'ℹ️' },
    { key: 'pending', id: 'ticket-beklemede_ingame', label: 'Beklemede', emoji: '⏳' },
    { key: 'review', id: 'ticket-inceleniyor_ingame', label: 'İnceleniyor', emoji: '🔍' },
    { key: 'resolved', id: 'ticket-çözüldü_ingame', label: 'Çözüldü', emoji: '✅' },
  ];
  const statusRow = new ActionRowBuilder().addComponents(
    statusButtons.map((b) => {
      const isActive = activeKey === b.key;
      const disabled = status === 'open' && b.key !== 'claim';
      return new ButtonBuilder()
        .setCustomId(b.id)
        .setLabel(b.label)
        .setStyle(b.key === 'resolved' ? (isActive ? ButtonStyle.Success : ButtonStyle.Secondary) : (isActive ? ButtonStyle.Primary : ButtonStyle.Secondary))
        .setEmoji(b.emoji)
        .setDisabled(disabled);
    })
  );

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(bulletContent))
    .addActionRowComponents(statusRow)
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));

  if (bannerImageURL) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder({ media: { url: bannerImageURL } })),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${TICKET_CONFIG.footerText}`),
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket-close_ingame').setLabel('Talebi Kapat').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId('ticket-notice_ingame').setLabel('Bildirim Al').setStyle(ButtonStyle.Secondary).setEmoji('🔔'),
    new ButtonBuilder().setCustomId('ticket-member_ingame').setLabel('Üyeleri Yönet').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
    new ButtonBuilder().setCustomId('ticket-transcript_ingame').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
  );

  return [container, actionRow];
}

/**
 * Görseldeki tasarıma uygun destek talebi embed'i (klasik embed).
 * @param {Object} options
 * @param {string} [options.ticketId] - Destek ID (örn. '2968')
 * @param {string} [options.createdBy] - Kullanıcı mention (örn. @Kelvin Ace)
 * @param {string} [options.createdAt] - Tarih metni (kalın için ** içinde verilebilir)
 * @param {string} [options.supportRole] - Yetkili ekibi metni (mention + bold kısım)
 * @param {string} [options.category] - Destek kategorisi
 * @param {string} [options.avgResponse] - Ortalama yanıt süresi
 * @param {string} [options.status] - Destek durumu (örn. 'ℹ️ Yetkili bekleniyor...')
 * @param {string} [options.authorIconURL] - Bot avatar URL (Author için)
 * @param {string} [options.thumbnailURL] - Sağ üst köşe thumbnail (kullanıcı avatarı)
 * @param {string} [options.embedImage] - Ana görsel URL (mor W logosu)
 */
function buildTicketDashboardEmbed(options = {}) {
  const ticketId = options.ticketId ?? '2968';
  const createdBy = options.createdBy ?? 'Kullanıcı';
  const createdAt = options.createdAt ?? new Date().toLocaleString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const supportRole = options.supportRole ?? '**Yetkili Ekibi** rolün sahip yetkililer sizinle ilgilenecek.';
  const category = options.category ?? 'Oyun İçi Destek';
  const avgResponse = options.avgResponse ?? '1 dakika - 8 dakika';
  const ticketStatus = options.ticketStatus ?? 'open';
  const claimedBy = options.claimedBy ?? null;
  const statusInfo = TICKET_STATUS_MAP[ticketStatus] || TICKET_STATUS_MAP.open;
  const status = typeof statusInfo.text === 'function' ? statusInfo.text(claimedBy) : statusInfo.text;
  const authorIconURL = options.authorIconURL ?? null;
  const thumbnailURL = options.thumbnailURL ?? null;
  const embedImage = options.embedImage ?? TICKET_CONFIG.defaultImageUrl;

  const description =
    `${createdBy} tarafından ticket talebi **${createdAt}** tarihinde oluşturuldu. ${supportRole}`;

  const embed = new EmbedBuilder()
    .setColor(0x0a0a0a)
    .setTitle(`✅ Destek Talebi #${ticketId}`)
    .setDescription(description)
    .addFields(
      { name: '• Destek ID', value: `#${ticketId}`, inline: false },
      { name: '• Destek Kategorisi', value: category, inline: false },
      { name: '\u200b', value: '\u200b', inline: false },
      { name: '• Ortalama Yanıt Süresi', value: avgResponse, inline: false },
      { name: '• Destek Durumu', value: status, inline: false },
    )
    .setFooter({ text: TICKET_CONFIG.footerText })
    .setTimestamp();

  if (authorIconURL) embed.setAuthor({ name: TICKET_CONFIG.authorName, iconURL: authorIconURL });
  else embed.setAuthor({ name: TICKET_CONFIG.authorName });
  if (thumbnailURL) embed.setThumbnail(thumbnailURL);
  if (embedImage) embed.setImage(embedImage);

  return embed;
}

/**
 * Üst satır: durum butonları; alt satır: aksiyon butonları.
 * activeStatus: 'claim'|'pending'|'review'|'resolved' (hangi durum aktif)
 */
function buildTicketDashboardButtons(activeStatus = null) {
  const statusButtons = [
    { key: 'claim', id: 'ticket_status_claim', label: 'Ticket Claim', emoji: 'ℹ️' },
    { key: 'pending', id: 'ticket_status_pending', label: 'Beklemede', emoji: '⏳' },
    { key: 'review', id: 'ticket_status_review', label: 'İnceleniyor', emoji: '🔍' },
    { key: 'resolved', id: 'ticket_status_resolved', label: 'Çözüldü', emoji: '✅' },
  ];

  const statusRow = new ActionRowBuilder().addComponents(
    statusButtons.map((b) => {
      const isActive = activeStatus === b.key;
      const style = b.key === 'resolved'
        ? (isActive ? ButtonStyle.Success : ButtonStyle.Secondary)
        : (isActive ? ButtonStyle.Primary : ButtonStyle.Secondary);
      return new ButtonBuilder()
        .setCustomId(b.id)
        .setLabel(b.label)
        .setStyle(style)
        .setEmoji(b.emoji);
    }),
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Talebi Kapat').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId('ticket_notify').setLabel('Bildirim Al').setStyle(ButtonStyle.Success).setEmoji('🔔'),
    new ButtonBuilder().setCustomId('ticket_members').setLabel('Üyeleri Yönet').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
    new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Transcript').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
  );

  return [statusRow, actionRow];
}

// Eski komut uyumluluğu için kısa isimler
function buildTicketEmbed(options = {}) {
  return buildTicketDashboardEmbed(options);
}

// Videodaki gibi: liste menüsü embed + gezinme butonları (sayfalama)
function buildListMenuEmbed(page = 0, items = LIST_ITEMS) {
  const totalPages = Math.max(1, Math.ceil(items.length / LIST_ITEMS_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const start = p * LIST_ITEMS_PER_PAGE;
  const slice = items.slice(start, start + LIST_ITEMS_PER_PAGE);
  const listText = slice.map((item, i) => `**${start + i + 1}.** ${item}`).join('\n') || '*Liste boş*';

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('◆ Uygulama / Kategori Listesi')
    .setDescription(listText)
    .setFooter({ text: `Sayfa ${p + 1} / ${totalPages} • Bir öğe seçmek için aşağıdaki menüyü kullanın` })
    .setTimestamp();
}

function buildListMenuComponents(page = 0, items = LIST_ITEMS) {
  const totalPages = Math.max(1, Math.ceil(items.length / LIST_ITEMS_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`list_prev_${p}`)
      .setLabel('Önceki')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
      .setDisabled(p <= 0),
    new ButtonBuilder()
      .setCustomId(`list_next_${p}`)
      .setLabel('Sonraki')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('▶️')
      .setDisabled(p >= totalPages - 1),
  );

  const options = items.map((item, i) => ({
    label: item.length > 100 ? item.slice(0, 97) + '...' : item,
    value: `list_select_${i}`,
    description: `Seç: ${item}`,
  })).slice(0, 25);

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('list_select')
      .setPlaceholder('Bir kategori / uygulama seçin...')
      .addOptions(options),
  );

  return [navRow, selectRow];
}

client.once('ready', async () => {
  console.log(`Bot giriş yaptı: ${client.user.tag}`);
  client.user.setActivity('/ticket-kur | Destek', { type: 3 });

  const commands = [
    new SlashCommandBuilder()
      .setName('ticket-kur')
      .setDescription('Destek talebi oluşturma panelini bu kanala gönderir.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-top')
      .setDescription('Ticket istatistikleri: en çok talep açan veya en çok devralan kullanıcılar.')
      .addStringOption((o) =>
        o.setName('tip').setDescription('Sıralama tipi').setRequired(true)
          .addChoices({ name: 'En çok ticket açan (açan)', value: 'opener' }, { name: 'En çok ticket devralan (yetkili)', value: 'staff' })
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-stat')
      .setDescription('Bir kullanıcının ticket istatistiklerini gösterir.')
      .addUserOption((o) => o.setName('user').setDescription('Kullanıcı').setRequired(true))
      .toJSON(),
  ];

  for (const [, guild] of client.guilds.cache) {
    try {
      const existing = await guild.commands.fetch();
      for (const cmd of commands) {
        if (!existing.some((c) => c.name === cmd.name)) {
          await guild.commands.create(cmd);
          console.log(`/${cmd.name} sunucuya eklendi: ${guild.name}`);
        }
      }
    } catch (e) {
      console.error(`Slash komut kaydı (${guild.name}):`, e?.message);
    }
  }
});

// Komut: !ticket veya !destek
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefix = '!';
  const text = message.content.trim().toLowerCase();
  const args = message.content.trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  // !ticket / !destek kaldırıldı – ticket sadece /ticket-kur panelinden açılıyor

  // Videodaki gibi: liste menüsü + gezinme butonları
  if (command === `${prefix}menu` || command === `${prefix}liste`) {
    const embed = buildListMenuEmbed(0);
    const components = buildListMenuComponents(0);
    await message.reply({ embeds: [embed], components }).catch(() => {
      message.channel.send({ embeds: [embed], components }).catch(console.error);
    });
  }
});

// Slash komut + buton (ticket-kur, ticket_create_*, ticket_close_channel)
client.on('interactionCreate', async (interaction) => {
  const id = interaction.customId || '';

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-kur') {
    const payload = buildTicketKurPanel();
    await interaction.reply({ content: 'Panel bu kanala gönderildi.', ephemeral: true }).catch(() => {});
    await interaction.channel?.send(payload).catch((e) => {
      console.error('Panel (Components V2) gönderilemedi:', e?.message);
      const embed = new EmbedBuilder()
        .setColor(0x0a0a0a)
        .setTitle('Destek Talebi Oluştur')
        .setDescription('> Bilet oluşturmadan önce aşağıdaki kuralları okuyunuz. Aşağıdaki butonlardan size uygun kategoriyi seçerek destek talebi oluşturabilirsiniz.')
        .addFields(
          { name: '**Genel Kurallar:**', value: '• Biletinizi **24 saat** içerisinde kontrol etmek zorundasınız.\n• Yönetim üyelerine özel mesaj atmaktan kaçının.\n• Sorunlarınızı bilet aracılığıyla iletişim kurun.', inline: false },
          { name: '**Sorun Bildirimi:**', value: '• Sorunu detaylı bir şekilde açıklayın.\n• Gerekli bilgileri eksiksiz paylaşın.', inline: false },
        )
        .setImage(TICKET_SETUP.panelImageUrl || null)
        .setFooter({ text: TICKET_SETUP.footerText });
      const c = TICKET_SETUP.categories;
      const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_create_oyunici').setLabel('Oyun İçi Destek').setStyle(ButtonStyle.Secondary).setEmoji(c.oyunici.emoji?.id && c.oyunici.emoji?.name ? { id: c.oyunici.emoji.id, name: c.oyunici.emoji.name } : '🎮'),
        new ButtonBuilder().setCustomId('ticket_create_teknik').setLabel('Teknik Destek').setStyle(ButtonStyle.Secondary).setEmoji(c.teknik.emoji?.id && c.teknik.emoji?.name ? { id: c.teknik.emoji.id, name: c.teknik.emoji.name } : '🔧'),
        new ButtonBuilder().setCustomId('ticket_create_donate').setLabel('Donate Bilgi').setStyle(ButtonStyle.Secondary).setEmoji(c.donate.emoji?.id && c.donate.emoji?.name ? { id: c.donate.emoji.id, name: c.donate.emoji.name } : '💳'),
      );
      const r2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_create_anticheat').setLabel('Anticheat').setStyle(ButtonStyle.Danger).setEmoji(c.anticheat.emoji?.id && c.anticheat.emoji?.name ? { id: c.anticheat.emoji.id, name: c.anticheat.emoji.name } : '🛡️'),
      );
      interaction.channel?.send({ embeds: [embed], components: [r1, r2] }).catch(() => {});
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-top') {
    if (!MONGODB_URI) {
      await interaction.reply({ content: 'Ticket istatistikleri MongoDB modu kapalı.', ephemeral: true }).catch(() => {});
      return;
    }
    const tip = interaction.options.getString('tip', true);
    const guildId = interaction.guildId;
    const list = tip === 'opener' ? await ticketTopOpeners(guildId, 10) : await ticketTopStaff(guildId, 10);
    const title = tip === 'opener' ? 'En çok ticket açan kullanıcılar' : 'En çok ticket devralan yetkililer';
    const lines = await Promise.all(list.map(async (r, i) => {
      const user = await client.users.fetch(r._id).catch(() => null);
      const tag = user ? `${user.username}` : r._id;
      return `${i + 1}. **${tag}** — ${r.count} ticket`;
    }));
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 ${title}`)
      .setDescription(lines.length ? lines.join('\n') : 'Henüz veri yok.')
      .setFooter({ text: 'MongoDB ticket kayıtları' })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-stat') {
    if (!MONGODB_URI) {
      await interaction.reply({ content: 'Ticket istatistikleri MongoDB modu kapalı.', ephemeral: true }).catch(() => {});
      return;
    }
    const user = interaction.options.getUser('user', true);
    const { opened, handled } = await ticketUserStats(interaction.guildId, user.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 Ticket istatistiği: ${user.username}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'Açtığı ticket', value: String(opened), inline: true },
        { name: 'Devraldığı ticket (yetkili)', value: String(handled), inline: true },
      )
      .setFooter({ text: 'MongoDB ticket kayıtları' })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.isButton() && id.startsWith('ticket_create_')) {
    const slug = id.replace('ticket_create_', '');
    if (Object.keys(TICKET_SETUP.categories).includes(slug)) {
      await createTicketChannel(interaction, slug);
      return;
    }
  }

  const ticketChannelPattern = new RegExp(`^[\\w-]+-(${Object.keys(TICKET_SETUP.categories).join('|')})-\\d+$`);
  const isTicketChannel = (ch) => ch?.name && ticketChannelPattern.test(ch.name);

  if (interaction.isButton() && (id === 'ticket_close_channel' || id === 'ticket-close_ingame' || id === 'ticket_close')) {
    const ch = interaction.channel;
    if (!isTicketChannel(ch)) {
      await interaction.reply({ content: 'Bu buton sadece destek talebi kanallarında kullanılabilir.', ephemeral: true }).catch(() => {});
      return;
    }
    const member = interaction.member;
    const userSlug = member.user.username.toLowerCase().replace(/\s/g, '-').slice(0, 20);
    const canClose = member.permissions.has(PermissionFlagsBits.ManageChannels) || ch.name.startsWith(userSlug + '-');
    if (!canClose) {
      await interaction.reply({ content: 'Bu talebi sadece talep sahibi veya yetkililer kapatabilir.', ephemeral: true }).catch(() => {});
      return;
    }
    await ticketClose(ch.id);
    await ticketEvent(interaction.guildId, ch.id, member.user.id, 'close');
    await interaction.reply({ content: 'Kanal kapatılıyor...', ephemeral: true }).catch(() => {});
    await ch.delete().catch((e) => console.error('Ticket kanalı silinemedi:', e?.message));
    return;
  }

  // Liste menüsü: Önceki / Sonraki (gezinme butonları)
  if (interaction.isButton() && (id.startsWith('list_prev_') || id.startsWith('list_next_'))) {
    const page = parseInt(id.replace('list_prev_', '').replace('list_next_', ''), 10);
    const newPage = id.startsWith('list_prev_') ? page - 1 : page + 1;
    const embed = buildListMenuEmbed(newPage);
    const components = buildListMenuComponents(newPage);
    await interaction.update({ embeds: [embed], components }).catch(() => {});
    return;
  }

  // Liste menüsü: Select'ten seçim
  if (interaction.isStringSelectMenu() && id === 'list_select') {
    const value = interaction.values[0] || '';
    const index = parseInt(value.replace('list_select_', ''), 10);
    const item = LIST_ITEMS[index];
    await interaction.reply({ content: `Seçiminiz: **${item}**`, ephemeral: true }).catch(() => {});
    return;
  }

  // Dashboard: durum butonuna tıklanınca (ticket kanalındaysa DB + embed güncelle)
  if (interaction.isButton() && id.startsWith('ticket_status_')) {
    const ch = interaction.channel;
    const key = id.replace('ticket_status_', '');
    if (isTicketChannel(ch)) {
      const ticket = await ticketFindByChannel(ch.id);
      const status = key === 'claim' ? 'claimed' : key;
      if (status === 'claimed') await ticketUpdateStatus(ch.id, status, interaction.user.id);
      else await ticketUpdateStatus(ch.id, status);
      await ticketEvent(interaction.guild.id, ch.id, ticket?.openerId || '0', status, status === 'claimed' ? interaction.user.id : null);
      const openerMember = ticket?.openerId ? (interaction.guild.members.cache.get(ticket.openerId) || await interaction.guild.members.fetch(ticket.openerId).catch(() => null)) : null;
      const thumbUrl = openerMember?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';
      const embed = buildTicketDashboardEmbed({
        ticketId: String(ticket?.ticketNum ?? '?'),
        createdBy: ticket?.openerId ? `<@${ticket.openerId}>` : 'Kullanıcı',
        createdAt: new Date((ticket?.createdAtUnix ?? Date.now() / 1000) * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        supportRole: '**Yetkili Ekibi** rolün sahip yetkililer sizinle ilgilenecek.',
        category: ticket?.categoryName ?? 'Destek',
        avgResponse: '1 dakika - 8 dakika',
        ticketStatus: status,
        claimedBy: status === 'claimed' ? interaction.user.id : ticket?.claimedBy ?? null,
        authorIconURL: client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }),
        thumbnailURL: thumbUrl,
        embedImage: TICKET_CONFIG.defaultImageUrl,
      });
      await interaction.update({ embeds: [embed], components: buildTicketDashboardButtons(key) }).catch(() => {});
    } else {
      await interaction.update({ components: buildTicketDashboardButtons(key) }).catch(() => {});
    }
    return;
  }

  // Ticket kanalındaki durum/aksiyon butonları (_ingame) – mesaj güncelle + MongoDB
  if (interaction.isButton() && id.endsWith('_ingame') && id !== 'ticket-close_ingame') {
    const ch = interaction.channel;
    if (!isTicketChannel(ch)) {
      await interaction.reply({ content: 'Bu buton sadece destek talebi kanallarında kullanılabilir.', ephemeral: true }).catch(() => {});
      return;
    }

    const ticket = await ticketFindByChannel(ch.id);
    const guild = interaction.guild;
    const member = interaction.member;

    const statusActions = {
      'ticket-claim_ingame': { status: 'claimed', claimedBy: member.user.id },
      'ticket-beklemede_ingame': { status: 'pending', claimedBy: null },
      'ticket-inceleniyor_ingame': { status: 'review', claimedBy: null },
      'ticket-çözüldü_ingame': { status: 'resolved', claimedBy: null },
    };

    if (statusActions[id]) {
      const { status, claimedBy } = statusActions[id];
      if (status === 'claimed') await ticketUpdateStatus(ch.id, status, claimedBy);
      else await ticketUpdateStatus(ch.id, status);
      await ticketEvent(guild.id, ch.id, ticket?.openerId || '0', status, status === 'claimed' ? member.user.id : null);

      const openerMember = ticket?.openerId ? (guild.members.cache.get(ticket.openerId) || await guild.members.fetch(ticket.openerId).catch(() => null)) : null;
      const thumbUrl = openerMember?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';

      const payload = {
        ticketId: String(ticket?.ticketNum ?? '?'),
        userId: ticket?.openerId ?? '',
        roleId: TICKET_CONFIG.roleId,
        category: ticket?.categoryName ?? 'Destek',
        status,
        claimedBy,
        createdAt: ticket?.createdAtUnix ?? Math.floor(Date.now() / 1000),
        thumbnailURL: thumbUrl,
        bannerImageURL: TICKET_CONFIG.defaultImageUrl,
      };

      const isEmbedMode = interaction.message.embeds?.length > 0;
      try {
        if (isEmbedMode) {
          const embed = buildTicketDashboardEmbed({
            ticketId: payload.ticketId,
            createdBy: ticket?.openerId ? `<@${ticket.openerId}>` : 'Kullanıcı',
            createdAt: new Date((payload.createdAt || 0) * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            supportRole: '**Yetkili Ekibi** rolün sahip yetkililer sizinle ilgilenecek.',
            category: payload.category,
            avgResponse: '1 dakika - 8 dakika',
            ticketStatus: status,
            claimedBy,
            authorIconURL: client.user?.displayAvatarURL?.({ extension: 'png', size: 128 }),
            thumbnailURL: thumbUrl,
            embedImage: TICKET_CONFIG.defaultImageUrl,
          });
          const activeKey = (TICKET_STATUS_MAP[status] && TICKET_STATUS_MAP[status].active) || null;
          await interaction.update({ embeds: [embed], components: buildTicketDashboardButtons(activeKey) });
        } else {
          const components = buildTicketComponentsV2(payload);
          await interaction.update({ components });
        }
      } catch (e) {
        await interaction.reply({ content: 'Mesaj güncellenirken hata oluştu.', ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (id === 'ticket-notice_ingame') {
      await ticketEvent(guild.id, ch.id, member.user.id, 'notify');
      await interaction.reply({ content: 'Bildirim tercihiniz kaydedildi.', ephemeral: true }).catch(() => {});
      return;
    }
    if (id === 'ticket-member_ingame') {
      await ticketEvent(guild.id, ch.id, member.user.id, 'member');
      await interaction.reply({ content: 'Üye eklemek/çıkarmak için yetkili kullanın veya kanal izinlerini düzenleyin.', ephemeral: true }).catch(() => {});
      return;
    }
    if (id === 'ticket-transcript_ingame') {
      await ticketEvent(guild.id, ch.id, member.user.id, 'transcript');
      const messages = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      const lines = messages ? Array.from(messages.values()).reverse().map((m) => `[${m.createdAt?.toISOString?.() || ''}] ${m.author?.tag || '?'}: ${m.content || '(embed/medya)'}`) : [];
      const text = lines.length ? lines.join('\n') : 'Mesaj yok.';
      await interaction.reply({
        content: 'Transcript (son 50 mesaj):',
        ephemeral: true,
        files: [{ name: `transcript-${ch.name}.txt`, attachment: Buffer.from(text, 'utf8') }],
      }).catch(() => interaction.reply({ content: 'Transcript oluşturuldu (çok uzun olabilir).', ephemeral: true }));
      return;
    }
  }

  if (interaction.isButton() && isTicketChannel(interaction.channel) && ['ticket_notify', 'ticket_members', 'ticket_transcript'].includes(id)) {
    await ticketEvent(interaction.guild.id, interaction.channel.id, interaction.user.id, id.replace('ticket_', ''));
    const msg = { ticket_notify: 'Bildirim tercihiniz kaydedildi.', ticket_members: 'Üye eklemek için yetkili kullanın.', ticket_transcript: 'Transcript oluşturuluyor...' };
    await interaction.reply({ content: msg[id] ?? 'İşlem alındı.', ephemeral: true }).catch(() => {});
    return;
  }

  if (!interaction.isButton()) return;
  if (!id.startsWith('ticket_')) return;

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  const messages = {
    ticket_claim: 'Ticket yetkili tarafından üstlenildi.',
    ticket_pending: 'Durum: Beklemede olarak güncellendi.',
    ticket_review: 'Durum: İnceleniyor olarak güncellendi.',
    ticket_resolved: 'Durum: Çözüldü olarak işaretlendi.',
    ticket_close: 'Bu talebi kapatmak için talep sahibi veya yetkili olmalısınız.',
    ticket_notify: 'Bildirim tercihleriniz kaydedildi.',
    ticket_members: 'Üye yönetimi için yetkili kullanın.',
    ticket_transcript: 'Transcript oluşturuluyor...',
  };

  await interaction.editReply({ content: messages[id] || 'İşlem alındı.' }).catch(() => {});
});

client.login(process.env.DISCORD_TOKEN).catch((e) => {
  console.error('Giriş hatası. .env dosyasında DISCORD_TOKEN tanımlı mı?', e.message);
});
