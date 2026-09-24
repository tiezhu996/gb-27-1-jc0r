import { Button, Input, Card, Typography, Tag, Space, message, Avatar, Modal, InputNumber, Row, Col, Statistic, Table } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, LikeOutlined, ClockCircleOutlined, StopOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { io, Socket } from 'socket.io-client';
import { liveClassApi, attendanceApi } from '@/api/live';
import { LiveClass as LiveClassType, LiveClassStatus, AttendanceStatus, AttendanceSummary, AttendanceSummaryRecord, ActiveCheckInSession } from '@/types/live';
import { useAuthStore } from '@/store/auth';
import { UserRole } from '@/types/user';

const { Title, Text } = Typography;

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: Date;
}

export default function LiveClass() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [liveClass, setLiveClass] = useState<LiveClassType | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [handRaised, setHandRaised] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveCheckInSession | null>(null);
  const [myCheckInStatus, setMyCheckInStatus] = useState<AttendanceStatus | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [lateGraceMinutes, setLateGraceMinutes] = useState(5);
  const [startingSession, setStartingSession] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { user } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isTeacher = user?.role === UserRole.TEACHER;

  useEffect(() => {
    if (id) {
      loadLiveClass();
      initSocket();
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 倒计时驱动
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 老师端考勤面板轮询；学生端签到会话轮询
  useEffect(() => {
    if (!id || !liveClass) return;

    if (isTeacher) {
      loadSummary();
      const timer = liveClass.status === LiveClassStatus.LIVE
        ? setInterval(loadSummary, 5000)
        : undefined;
      return () => {
        if (timer) clearInterval(timer);
      };
    }

    if (liveClass.status === LiveClassStatus.LIVE) {
      loadActiveSession();
      const timer = setInterval(loadActiveSession, 10000);
      return () => clearInterval(timer);
    }
    setActiveSession(null);
  }, [id, liveClass?.status, isTeacher]);

  const loadLiveClass = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await liveClassApi.get(id);
      setLiveClass(data);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    if (!id) return;
    try {
      const data = await attendanceApi.getSummary(id);
      setSummary(data);
    } catch {
      // 老师未发起签到时不打扰
    }
  };

  const loadActiveSession = async () => {
    if (!id) return;
    try {
      const data = await attendanceApi.getActiveSession(id);
      setActiveSession(data);
      if (data?.myStatus) {
        setMyCheckInStatus(data.myStatus);
      }
    } catch {
      setActiveSession(null);
    }
  };

  const initSocket = () => {
    const socket = io('/socket.io/chat', {
      query: {
        roomId: id,
        userId: user?.id,
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('userJoined', (data: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          userId: data.userId,
          userName: '系统',
          message: `${data.userName || '某用户'} 进入了直播间`,
          timestamp: new Date(),
        },
      ]);
    });

    socket.on('userLeft', (data: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          userId: data.userId,
          userName: '系统',
          message: `${data.userName || '某用户'} 离开了直播间`,
          timestamp: new Date(),
        },
      ]);
    });

    socket.on('handRaised', (data: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          userId: data.userId,
          userName: '系统',
          message: `${data.userName} 举手了`,
          timestamp: new Date(),
        },
      ]);
    });

    socket.on('handLowered', (data: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          userId: data.userId,
          userName: '系统',
          message: `${data.userName || '某用户'} 放下了手`,
          timestamp: new Date(),
        },
      ]);
    });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || !socketRef.current) return;
    socketRef.current.emit('sendMessage', {
      roomId: id,
      message: inputMessage,
      userId: user?.id,
      userName: user?.name,
    });
    setInputMessage('');
  };

  const toggleHand = () => {
    if (!socketRef.current) return;
    if (handRaised) {
      socketRef.current.emit('lowerHand', { roomId: id, userId: user?.id });
    } else {
      socketRef.current.emit('raiseHand', { roomId: id, userId: user?.id, userName: user?.name });
    }
    setHandRaised(!handRaised);
  };

  const handleCheckIn = async () => {
    if (!id) return;
    try {
      const record = await attendanceApi.checkIn(id);
      setMyCheckInStatus(record.status);
      message.success(record.status === AttendanceStatus.LATE ? '签到成功（迟到）' : '签到成功');
    } catch (error: any) {
      message.error(error.response?.data?.message || '签到失败');
    }
  };

  const handleStartSession = async () => {
    if (!id) return;
    setStartingSession(true);
    try {
      await attendanceApi.startSession({ liveClassId: id, durationMinutes, lateGraceMinutes });
      message.success('签到已发起');
      setCheckInModalOpen(false);
      await loadSummary();
    } catch (error: any) {
      message.error(error.response?.data?.message || '发起签到失败');
    } finally {
      setStartingSession(false);
    }
  };

  const handleCloseSession = async () => {
    if (!summary?.session) return;
    try {
      await attendanceApi.closeSession(summary.session.id);
      message.success('签到已关闭');
      await loadSummary();
    } catch (error: any) {
      message.error(error.response?.data?.message || '关闭签到失败');
    }
  };

  const handleExport = async () => {
    if (!id) return;
    setExporting(true);
    try {
      const blob = await attendanceApi.exportExcel(id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `考勤记录-${liveClass?.title || id}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      message.success('考勤报表已导出');
    } catch (error: any) {
      message.error(error.response?.data?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const startLive = async () => {
    if (!id) return;
    try {
      const updated = await liveClassApi.start(id);
      setLiveClass(updated);
      message.success('直播已开始');
    } catch (error: any) {
      message.error(error.response?.data?.message || '开始直播失败');
    }
  };

  const endLive = async () => {
    if (!id) return;
    try {
      const updated = await liveClassApi.end(id);
      setLiveClass(updated);
      message.success('直播已结束');
    } catch (error: any) {
      message.error(error.response?.data?.message || '结束直播失败');
    }
  };

  const getStatusTag = (status: LiveClassStatus) => {
    switch (status) {
      case LiveClassStatus.LIVE:
        return <Tag color="red">直播中</Tag>;
      case LiveClassStatus.SCHEDULED:
        return <Tag color="blue">未开始</Tag>;
      case LiveClassStatus.ENDED:
        return <Tag color="gray">已结束</Tag>;
    }
  };

  const formatCountdown = (targetTime: string) => {
    const diff = Math.max(0, new Date(targetTime).getTime() - now);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const sessionActive = summary?.session?.status === 'active';

  const attendanceColumns: ColumnsType<AttendanceSummaryRecord> = [
    { title: '学生姓名', dataIndex: 'studentName', key: 'studentName' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: AttendanceStatus) => {
        if (status === AttendanceStatus.PRESENT) return <Tag color="green">正常</Tag>;
        if (status === AttendanceStatus.LATE) return <Tag color="orange">迟到</Tag>;
        return <Tag color="red">缺勤</Tag>;
      },
    },
    {
      title: '签到时间',
      dataIndex: 'checkInTime',
      key: 'checkInTime',
      width: 200,
      render: (time?: string) => (time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '-'),
    },
  ];

  if (loading) {
    return <Card><div style={{ textAlign: 'center', padding: 50 }}>加载中...</div></Card>;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <Title level={3} style={{ margin: 0 }}>
          {liveClass?.title}
        </Title>
        {liveClass && getStatusTag(liveClass.status)}
      </Space>

      <div className="live-container">
        <div className="live-video-area">
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ color: 'white' }}>直播区域</Title>
            <Text style={{ color: 'white', opacity: 0.7 }}>
              {liveClass?.status === LiveClassStatus.LIVE ? '直播进行中...' : '等待直播开始...'}
            </Text>
            <div style={{ marginTop: 24 }}>
              <Space wrap style={{ justifyContent: 'center' }}>
                {isTeacher && liveClass?.status === LiveClassStatus.SCHEDULED && (
                  <Button type="primary" size="large" onClick={startLive}>
                    开始直播
                  </Button>
                )}
                {isTeacher && liveClass?.status === LiveClassStatus.LIVE && !sessionActive && (
                  <Button size="large" icon={<ClockCircleOutlined />} onClick={() => setCheckInModalOpen(true)}>
                    发起签到
                  </Button>
                )}
                {isTeacher && liveClass?.status === LiveClassStatus.LIVE && sessionActive && (
                  <Tag color="processing" icon={<ClockCircleOutlined />} style={{ padding: '4px 12px', fontSize: 14 }}>
                    签到进行中
                  </Tag>
                )}
                {isTeacher && liveClass?.status === LiveClassStatus.LIVE && (
                  <Button type="primary" danger size="large" onClick={endLive}>
                    结束直播
                  </Button>
                )}
                {isTeacher && liveClass?.status === LiveClassStatus.ENDED && summary?.session && (
                  <Button
                    type="primary"
                    size="large"
                    icon={<FileExcelOutlined />}
                    loading={exporting}
                    onClick={handleExport}
                  >
                    导出考勤 Excel
                  </Button>
                )}
                {!isTeacher && liveClass?.status === LiveClassStatus.LIVE && activeSession && !myCheckInStatus && (
                  <Button
                    type="primary"
                    size="large"
                    danger={activeSession.phase === 'late'}
                    icon={<CheckCircleOutlined />}
                    onClick={handleCheckIn}
                  >
                    {activeSession.phase === 'normal'
                      ? `签到（剩余 ${formatCountdown(activeSession.normalEndTime)}）`
                      : `迟到签到（剩余 ${formatCountdown(activeSession.lateEndTime)}）`}
                  </Button>
                )}
                {!isTeacher && liveClass?.status === LiveClassStatus.LIVE && myCheckInStatus && (
                  <Tag color={myCheckInStatus === AttendanceStatus.LATE ? 'orange' : 'green'} style={{ padding: '4px 12px', fontSize: 14 }}>
                    <CheckCircleOutlined /> {myCheckInStatus === AttendanceStatus.LATE ? '已签到（迟到）' : '已签到（正常）'}
                  </Tag>
                )}
                {!isTeacher && liveClass?.status === LiveClassStatus.LIVE && !activeSession && !myCheckInStatus && (
                  <Text style={{ color: 'white', opacity: 0.7 }}>等待老师发起签到...</Text>
                )}
              </Space>
            </div>
            {!isTeacher && activeSession && !myCheckInStatus && (
              <div style={{ marginTop: 12 }}>
                <Text style={{ color: activeSession.phase === 'normal' ? '#52c41a' : '#faad14' }}>
                  {activeSession.phase === 'normal' ? '签到进行中，请在规定时间内完成' : '已进入迟到宽限时段，签到将记为迟到'}
                </Text>
              </div>
            )}
          </div>
        </div>

        <div className="live-sidebar">
          <Card title="互动聊天" size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="chat-messages">
              {messages.map((msg) => (
                <div key={msg.id} className="chat-message">
                  <Space>
                    <Avatar size="small" style={{ background: '#1890ff' }}>
                      {msg.userName?.[0]}
                    </Avatar>
                    <div>
                      <Text strong>{msg.userName}</Text>
                      <div style={{ fontSize: 14 }}>{msg.message}</div>
                    </div>
                  </Space>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="输入弹幕消息..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onPressEnter={sendMessage}
                />
                <Button type="primary" onClick={sendMessage}>
                  发送
                </Button>
              </Space.Compact>
              <div style={{ marginTop: 12 }}>
                <Space>
                  <Button
                    type={handRaised ? 'primary' : 'default'}
                    icon={<LikeOutlined />}
                    onClick={toggleHand}
                    disabled={liveClass?.status !== LiveClassStatus.LIVE}
                  >
                    {handRaised ? '放下手' : '举手'}
                  </Button>
                </Space>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {isTeacher && summary?.session && (
        <Card
          title={
            <Space>
              <span>课堂考勤</span>
              {sessionActive ? (
                <Tag color="processing">
                  进行中 · {summary.session.durationMinutes} 分钟签到 + {summary.session.lateGraceMinutes} 分钟宽限
                </Tag>
              ) : (
                <Tag color="default">已关闭</Tag>
              )}
            </Space>
          }
          extra={
            sessionActive && (
              <Button danger icon={<StopOutlined />} onClick={handleCloseSession}>
                关闭签到
              </Button>
            )
          }
          style={{ marginTop: 16 }}
        >
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic title="应到" value={summary.expected} />
            </Col>
            <Col span={6}>
              <Statistic title="实到" value={summary.present} valueStyle={{ color: '#52c41a' }} />
            </Col>
            <Col span={6}>
              <Statistic title="迟到" value={summary.late} valueStyle={{ color: '#fa8c16' }} />
            </Col>
            <Col span={6}>
              <Statistic title="缺勤" value={summary.absent} valueStyle={{ color: '#f5222d' }} />
            </Col>
          </Row>
          <Table
            columns={attendanceColumns}
            dataSource={summary.records}
            rowKey="studentId"
            size="small"
            pagination={false}
            scroll={{ y: 320 }}
          />
        </Card>
      )}

      <Modal
        title="发起限时签到"
        open={checkInModalOpen}
        onOk={handleStartSession}
        confirmLoading={startingSession}
        onCancel={() => setCheckInModalOpen(false)}
        okText="发起"
        cancelText="取消"
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 16 }}>
            <Text>签到时长（分钟）：规定时间内签到记为正常</Text>
            <div style={{ marginTop: 8 }}>
              <InputNumber
                min={1}
                max={120}
                value={durationMinutes}
                onChange={(v) => setDurationMinutes(v ?? 5)}
                addonAfter="分钟"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div>
            <Text>迟到宽限（分钟）：超过签到时长后仍可签到，记为迟到；设为 0 表示不允许迟到</Text>
            <div style={{ marginTop: 8 }}>
              <InputNumber
                min={0}
                max={60}
                value={lateGraceMinutes}
                onChange={(v) => setLateGraceMinutes(v ?? 0)}
                addonAfter="分钟"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
