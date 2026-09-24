import {
  Button,
  Input,
  Card,
  Typography,
  Tag,
  Space,
  message,
  Avatar,
  Statistic,
  Table,
  Modal,
  InputNumber,
  Form,
  Empty,
  Alert,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  LikeOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { liveClassApi, attendanceApi } from '@/api/live';
import { LiveClass as LiveClassType, LiveClassStatus } from '@/types/live';
import {
  AttendanceOverview,
  AttendanceStatus,
  CheckInPhase,
  CheckInSession,
} from '@/types/attendance';
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

const STATUS_TAG: Record<AttendanceStatus, { color: string; text: string }> = {
  [AttendanceStatus.PRESENT]: { color: 'green', text: '正常' },
  [AttendanceStatus.LATE]: { color: 'orange', text: '迟到' },
  [AttendanceStatus.ABSENT]: { color: 'red', text: '缺勤' },
};

/** 将倒计时（毫秒）格式化为 mm:ss */
function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function LiveClass() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [liveClass, setLiveClass] = useState<LiveClassType | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [handRaised, setHandRaised] = useState(false);

  // 签到相关状态
  const [session, setSession] = useState<CheckInSession | null>(null);
  const [overview, setOverview] = useState<AttendanceOverview | null>(null);
  const [myStatus, setMyStatus] = useState<AttendanceStatus | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [createForm] = Form.useForm();

  const { user } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isTeacher = user?.role === UserRole.TEACHER;
  const isLive = liveClass?.status === LiveClassStatus.LIVE;

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

  // 每秒刷新，驱动倒计时与迟到/关闭阶段切换
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 直播中轮询签到状态；老师持续看名单，结束后停止
  useEffect(() => {
    if (!id || !isLive) return;
    const timer = setInterval(() => {
      if (isTeacher) {
        refreshOverview();
      } else {
        refreshStudentSession();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [id, isLive, isTeacher]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadLiveClass = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await liveClassApi.get(id);
      setLiveClass(data);
      if (user?.role === UserRole.TEACHER) {
        await refreshOverview();
      } else {
        await refreshStudentSession();
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '加载直播课堂失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshOverview = useCallback(async () => {
    if (!id) return;
    try {
      const data = await attendanceApi.getOverview(id);
      setOverview(data);
      setSession(data.session);
    } catch {
      // 非授课老师或课堂异常时静默，保持页面可用
    }
  }, [id]);

  const refreshStudentSession = useCallback(async () => {
    if (!id) return;
    try {
      const [activeSession, myRecords] = await Promise.all([
        attendanceApi.getSession(id),
        attendanceApi.getMyRecords(),
      ]);
      setSession(activeSession);
      const mine = (myRecords as Array<{ liveClassId: string; status: AttendanceStatus }>).find(
        (r) => r.liveClassId === id,
      );
      setMyStatus(mine?.status ?? null);
    } catch {
      // 未登录等情况忽略
    }
  }, [id]);

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
      await refreshOverview();
      message.success('直播已结束');
    } catch (error: any) {
      message.error(error.response?.data?.message || '结束直播失败');
    }
  };

  const handleCreateSession = async () => {
    const values = await createForm.validateFields();
    if (!id) return;
    setCreating(true);
    try {
      const created = await attendanceApi.createSession(
        id,
        values.durationMinutes,
        values.graceMinutes ?? 0,
      );
      setSession(created);
      setCreateModalOpen(false);
      createForm.resetFields();
      message.success('签到已发起');
      await refreshOverview();
    } catch (error: any) {
      message.error(error.response?.data?.message || '发起签到失败');
    } finally {
      setCreating(false);
    }
  };

  const handleCloseSession = async () => {
    if (!id) return;
    try {
      const closed = await attendanceApi.closeSession(id);
      setSession(closed);
      message.success('签到已关闭');
      await refreshOverview();
    } catch (error: any) {
      message.error(error.response?.data?.message || '关闭签到失败');
    }
  };

  const handleCheckIn = async () => {
    if (!id) return;
    setCheckingIn(true);
    try {
      const record = await attendanceApi.checkIn(id);
      setMyStatus(record.status as AttendanceStatus);
      message.success(record.status === AttendanceStatus.LATE ? '签到成功（迟到）' : '签到成功');
    } catch (error: any) {
      message.error(error.response?.data?.message || '签到失败');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;
    try {
      await attendanceApi.exportAttendance(id);
      message.success('考勤表已导出');
    } catch (error: any) {
      message.error(error.response?.data?.message || '导出失败');
    }
  };

  /** 依据本地时钟推导签到阶段（服务端 phase 仅作快照，倒计时靠本地驱动） */
  const derivePhase = (s: CheckInSession | null): CheckInPhase | null => {
    if (!s) return null;
    if (s.closedAt || now > new Date(s.lateEndAt).getTime()) return CheckInPhase.CLOSED;
    if (now > new Date(s.presentEndAt).getTime()) return CheckInPhase.LATE;
    return CheckInPhase.PRESENT;
  };

  const phase = derivePhase(session);
  const deadline =
    phase === CheckInPhase.PRESENT
      ? session?.presentEndAt
      : phase === CheckInPhase.LATE
        ? session?.lateEndAt
        : null;
  const remainingMs = deadline ? new Date(deadline).getTime() - now : 0;

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

  const rosterColumns = [
    {
      title: '学生',
      dataIndex: 'studentName',
      key: 'studentName',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 72,
      render: (status: AttendanceStatus) => (
        <Tag color={STATUS_TAG[status].color}>{STATUS_TAG[status].text}</Tag>
      ),
    },
    {
      title: '签到时间',
      dataIndex: 'checkInTime',
      key: 'checkInTime',
      width: 92,
      render: (t: string | null) =>
        t ? new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) : '-',
    },
  ];

  const renderTeacherAttendance = () => (
    <Card
      title="课堂签到"
      size="small"
      style={{ maxHeight: '45%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { overflowY: 'auto', flex: 1, minHeight: 0 } }}
      extra={
        liveClass?.status === LiveClassStatus.ENDED ? (
          <Button size="small" type="primary" icon={<ExportOutlined />} onClick={handleExport}>
            导出Excel
          </Button>
        ) : undefined
      }
    >
      {overview ? (
        <>
          <Space size="small" wrap style={{ marginBottom: 12 }}>
            <Statistic title="应到" value={overview.summary.expected} />
            <Statistic title="实到" value={overview.summary.actual} valueStyle={{ color: '#3f8600' }} />
            <Statistic title="迟到" value={overview.summary.late} valueStyle={{ color: '#d48806' }} />
            <Statistic title="缺勤" value={overview.summary.absent} valueStyle={{ color: '#cf1322' }} />
          </Space>

          {isLive && (
            <div style={{ marginBottom: 12 }}>
              {phase === null && (
                <Button type="primary" block onClick={() => setCreateModalOpen(true)}>
                  发起限时签到
                </Button>
              )}
              {phase === CheckInPhase.PRESENT && (
                <Space.Compact style={{ width: '100%' }}>
                  <Button block icon={<ClockCircleOutlined />}>
                    签到中 {formatCountdown(remainingMs)}
                  </Button>
                  <Button danger icon={<StopOutlined />} onClick={handleCloseSession}>
                    关闭
                  </Button>
                </Space.Compact>
              )}
              {phase === CheckInPhase.LATE && (
                <Space.Compact style={{ width: '100%' }}>
                  <Button block style={{ color: '#d48806', borderColor: '#ffd591' }}>
                    迟到宽限 {formatCountdown(remainingMs)}
                  </Button>
                  <Button danger icon={<StopOutlined />} onClick={handleCloseSession}>
                    关闭
                  </Button>
                </Space.Compact>
              )}
              {phase === CheckInPhase.CLOSED && (
                <Tag color="default" style={{ padding: '4px 8px' }}>
                  签到已关闭
                </Tag>
              )}
            </div>
          )}

          <Table
            size="small"
            rowKey="studentId"
            columns={rosterColumns}
            dataSource={overview.roster}
            pagination={false}
            scroll={{ y: 200 }}
          />
        </>
      ) : (
        <Empty description="暂无考勤数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Card>
  );

  const renderStudentCheckIn = () => {
    if (!isLive) {
      return (
        <Alert
          type="info"
          message={
            liveClass?.status === LiveClassStatus.ENDED
              ? '直播已结束'
              : '直播开始后由老师发起签到'
          }
        />
      );
    }
    if (myStatus) {
      return (
        <Alert
          type={myStatus === AttendanceStatus.LATE ? 'warning' : 'success'}
          message={
            myStatus === AttendanceStatus.LATE ? '已签到（迟到）' : '签到成功'
          }
        />
      );
    }
    if (phase === CheckInPhase.PRESENT) {
      return (
        <Space direction="vertical" style={{ width: '100%' }} size={4}>
          <Button
            type="primary"
            block
            size="large"
            icon={<CheckCircleOutlined />}
            loading={checkingIn}
            onClick={handleCheckIn}
          >
            立即签到
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            距正常签到结束 {formatCountdown(remainingMs)}
          </Text>
        </Space>
      );
    }
    if (phase === CheckInPhase.LATE) {
      return (
        <Space direction="vertical" style={{ width: '100%' }} size={4}>
          <Button
            block
            size="large"
            danger
            icon={<ClockCircleOutlined />}
            loading={checkingIn}
            onClick={handleCheckIn}
          >
            迟到签到（剩余 {formatCountdown(remainingMs)}）
          </Button>
          <Text type="warning" style={{ fontSize: 12 }}>
            已超过正常签到时间，当前签到将记为迟到
          </Text>
        </Space>
      );
    }
    if (phase === CheckInPhase.CLOSED) {
      return <Alert type="error" message="签到已关闭，无法再签到" />;
    }
    return <Alert type="info" message="等待老师发起签到…" />;
  };

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
              {isLive ? '直播进行中...' : liveClass?.status === LiveClassStatus.ENDED ? '直播已结束' : '等待直播开始...'}
            </Text>
            <div style={{ marginTop: 24 }}>
              <Space>
                {isTeacher && liveClass?.status === LiveClassStatus.SCHEDULED && (
                  <Button type="primary" size="large" onClick={startLive}>
                    开始直播
                  </Button>
                )}
                {isTeacher && isLive && (
                  <Button type="primary" danger size="large" onClick={endLive}>
                    结束直播
                  </Button>
                )}
              </Space>
            </div>
          </div>
        </div>

        <div className="live-sidebar">
          {isTeacher ? renderTeacherAttendance() : (
            <Card title="课堂签到" size="small">
              {renderStudentCheckIn()}
            </Card>
          )}

          <Card
            title="互动聊天"
            size="small"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            styles={{ body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }}
          >
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
                    disabled={!isLive}
                  >
                    {handRaised ? '放下手' : '举手'}
                  </Button>
                </Space>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        title="发起限时签到"
        open={createModalOpen}
        onOk={handleCreateSession}
        confirmLoading={creating}
        onCancel={() => setCreateModalOpen(false)}
        okText="发起签到"
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical" initialValues={{ durationMinutes: 5, graceMinutes: 5 }}>
          <Form.Item
            name="durationMinutes"
            label="签到时长（分钟）"
            rules={[{ required: true, message: '请设置正常签到时长' }]}
            extra="该时段内签到记为正常到课"
          >
            <InputNumber min={1} max={300} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
          <Form.Item
            name="graceMinutes"
            label="迟到宽限（分钟）"
            extra="超过签到时长、仍在宽限内提交记为迟到；宽限结束后不再接收"
          >
            <InputNumber min={0} max={300} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
